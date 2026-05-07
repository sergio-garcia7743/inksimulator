import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Zap, Play, Pause, RotateCcw } from 'lucide-react';

// --- Types ---

interface SimulationParams {
  voltage: number;
  frequency: number;
  amplitude: number;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  life: number;
}

interface LabSample {
  sample: number;
  f: number;
  v: number;
  a: number;
  area: number;
}

interface PredictionResult {
  area: number;
  nearest: LabSample;
  conf: number;
}

// --- Lab Data (all 17 physical measurements) ---

const LAB_DATA: LabSample[] = [
  { sample: 1,  f: 1000, v: 2.79, a: 60, area: 6148728 },
  { sample: 2,  f: 1000, v: 2.79, a: 70, area: 5742530 },
  { sample: 3,  f: 1500, v: 2.79, a: 70, area: 4729759 },
  { sample: 4,  f: 2000, v: 2.79, a: 70, area: 6034987 },
  { sample: 5,  f: 3000, v: 2.79, a: 70, area: 4234619 },
  { sample: 6,  f: 1000, v: 2.79, a: 80, area: 2607274 },
  { sample: 7,  f: 2000, v: 2.79, a: 80, area: 3529894 },
  { sample: 8,  f: 3000, v: 2.79, a: 80, area: 3437267 },
  { sample: 9,  f: 1000, v: 2.79, a: 20, area: 7191637 },
  { sample: 10, f: 2000, v: 2.79, a: 20, area: 5879252 },
  { sample: 11, f: 3000, v: 2.79, a: 20, area: 7115786 },
  { sample: 12, f: 1000, v: 2.79, a: 40, area: 5810690 },
  { sample: 13, f: 2000, v: 2.89, a: 40, area: 1149901 },
  { sample: 14, f: 3000, v: 2.89, a: 40, area: 3307079 },
  { sample: 15, f: 1000, v: 2.89, a: 40, area: 2510874 },
  { sample: 16, f: 500,  v: 2.89, a: 40, area: 3230173 },
  { sample: 17, f: 100,  v: 3.00, a: 40, area: 1565883 },
];

// Normalization ranges derived from data extents
const V_MIN = 2.79, V_MAX = 3.00;
const F_MIN = 100,  F_MAX = 3000;
const A_MIN = 20,   A_MAX = 80;

/**
 * Inverse Distance Weighting interpolation over all 17 lab samples.
 * Voltage is weighted 2.5×, amplitude 1.5×, frequency 1.0× based on
 * observed sensitivity in the physical measurements.
 */
function predictDropletArea(v: number, f: number, a: number): PredictionResult {
  const vN = (v - V_MIN) / (V_MAX - V_MIN + 1e-9);
  const fN = (f - F_MIN) / (F_MAX - F_MIN);
  const aN = (a - A_MIN) / (A_MAX - A_MIN);

  let weightSum = 0;
  let valueSum = 0;
  let minDist = Infinity;
  let nearest = LAB_DATA[0];

  for (const d of LAB_DATA) {
    const dvN = (d.v - V_MIN) / (V_MAX - V_MIN + 1e-9);
    const dfN = (d.f - F_MIN) / (F_MAX - F_MIN);
    const daN = (d.a - A_MIN) / (A_MAX - A_MIN);

    const dist = Math.sqrt(
      2.5 * Math.pow(vN - dvN, 2) +
      1.0 * Math.pow(fN - dfN, 2) +
      1.5 * Math.pow(aN - daN, 2)
    );

    if (dist < 1e-6) {
      return { area: d.area, nearest: d, conf: 100 };
    }

    const w = 1 / Math.pow(dist, 2);
    weightSum += w;
    valueSum += w * d.area;

    if (dist < minDist) {
      minDist = dist;
      nearest = d;
    }
  }

  const predicted = valueSum / weightSum;
  const conf = Math.max(20, Math.min(98, Math.round(100 - minDist * 120)));
  return { area: predicted, nearest, conf };
}

// --- Main App ---

export default function App() {
  const [params, setParams] = useState<SimulationParams>({
    voltage: 2.89,
    frequency: 1000,
    amplitude: 40,
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);

  const simCanvasRef = useRef<HTMLCanvasElement>(null);
  const microCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number | null>(null);
  const lastEmitRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const playingRef = useRef(false);
  const paramsRef = useRef(params);
  const predRef = useRef<PredictionResult | null>(null);

  const prediction = useMemo(
    () => predictDropletArea(params.voltage, params.frequency, params.amplitude),
    [params.voltage, params.frequency, params.amplitude]
  );

  // Keep refs in sync
  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { predRef.current = prediction; }, [prediction]);

  // Draw microscope view whenever prediction changes
  useEffect(() => {
    const canvas = microCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < W; i += 15) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(W, i); ctx.stroke();
    }

    const cx = W / 2;
    const cy = H / 2;
    // Radius from area assuming circular droplet
    const radiusPx = Math.sqrt(prediction.area / Math.PI) / 175;
    const r = Math.max(5, Math.min(72, radiusPx));

    const grad = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, 0, cx, cy, r);
    grad.addColorStop(0, '#e2e8f0');
    grad.addColorStop(0.55, '#64748b');
    grad.addColorStop(1, '#1e293b');

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(56,189,248,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Diameter indicator
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 0.8;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cx - r - 8, cy);
    ctx.lineTo(cx + r + 8, cy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Label
    const areaK = Math.round(prediction.area / 1000);
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 9px ui-monospace, monospace';
    ctx.fillText(`${areaK.toLocaleString()}k µm²`, cx - 28, cy - r - 7);
  }, [prediction]);

  // Canvas animation loop
  const animate = useCallback((time: number) => {
    if (!playingRef.current) return;

    const canvas = simCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const freq = paramsRef.current.frequency;
    const pred = predRef.current;
    const emitInterval = Math.max(16, (1000 / freq) * 3);

    if (!lastEmitRef.current || time - lastEmitRef.current > emitInterval) {
      if (pred) {
        const radiusPx = Math.sqrt(pred.area / Math.PI) / 900 * canvas.height * 0.12;
        const size = Math.max(4, Math.min(32, radiusPx));
        particlesRef.current.push({
          id: Math.random(),
          x: canvas.width * 0.08,
          y: canvas.height * 0.5,
          size,
          life: 1.0,
        });
      }
      lastEmitRef.current = time;
    }

    particlesRef.current = particlesRef.current
      .map(p => ({ ...p, x: p.x + 1.4, life: p.life - 0.004 }))
      .filter(p => p.x < canvas.width && p.life > 0);

    for (const p of particlesRef.current) {
      const alpha = Math.min(1, p.life * 2) * 0.88;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#38bdf8';
      ctx.shadowColor = 'rgba(56,189,248,0.5)';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    animRef.current = requestAnimationFrame(animate);
  }, []);

  // Resize canvas to match viewport
  useEffect(() => {
    const resize = () => {
      const canvas = simCanvasRef.current;
      const vp = viewportRef.current;
      if (canvas && vp) {
        canvas.width = vp.clientWidth;
        canvas.height = vp.clientHeight;
      }
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const startPlaying = useCallback(() => {
    playingRef.current = true;
    setIsPlaying(true);
    lastEmitRef.current = 0;
    animRef.current = requestAnimationFrame(animate);
  }, [animate]);

  const stopPlaying = useCallback(() => {
    playingRef.current = false;
    setIsPlaying(false);
    if (animRef.current) cancelAnimationFrame(animRef.current);
  }, []);

  const handleReset = useCallback(() => {
    stopPlaying();
    particlesRef.current = [];
    const canvas = simCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
    setParticles([]);
  }, [stopPlaying]);

  const togglePlay = useCallback(() => {
    if (playingRef.current) stopPlaying();
    else startPlaying();
  }, [startPlaying, stopPlaying]);

  // Derived display values
  const areaK = Math.round(prediction.area / 1000);
  const areaMM = (prediction.area / 1_000_000).toFixed(3);
  const conf = prediction.conf;
  const n = prediction.nearest;
  const traceAcc = Math.max(94.0, Math.min(99.9, 99.4 - (prediction.area / 1_000_000 - 3) * 0.8)).toFixed(1);

  const insight =
    prediction.area > 6_000_000
      ? 'Very large droplet predicted. High risk of puddle formation and trace bridging on substrate.'
      : prediction.area > 4_000_000
      ? 'Large deposition zone. Suitable for coarse trace widths. Monitor substrate adhesion closely.'
      : prediction.area > 2_000_000
      ? 'Moderate droplet size. Good jetting stability. Suitable for standard trace geometries.'
      : 'Small droplet regime. Excellent for fine-pitch traces. Verify jetting consistency at this amplitude.';

  const confColor =
    conf > 75 ? '#22c55e' : conf > 50 ? '#f59e0b' : '#ef4444';

  const freqDisplay =
    params.frequency >= 1000
      ? `${(params.frequency / 1000).toFixed(2)} kHz`
      : `${params.frequency} Hz`;

  const nearFreqDisplay =
    n.f >= 1000 ? `${(n.f / 1000).toFixed(1)} kHz` : `${n.f} Hz`;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: '#020617',
        color: '#cbd5e1',
        fontFamily: 'ui-monospace, "Cascadia Code", "Fira Mono", monospace',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <header
        style={{
          height: 52,
          flexShrink: 0,
          background: '#0f172a',
          borderBottom: '1px solid #1e293b',
          padding: '0 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 28,
              height: 28,
              background: '#1d4ed8',
              borderRadius: 5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Zap size={16} color="#fff" />
          </div>
          <span style={{ fontSize: 13, color: '#94a3b8', letterSpacing: '0.06em' }}>
            AgCite 90072{' '}
            <span style={{ color: '#475569', fontWeight: 400 }}>Flow Dynamics v2.5.0</span>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              fontSize: 10,
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 99,
              padding: '4px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              letterSpacing: '0.1em',
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: isPlaying ? '#22c55e' : '#334155',
                display: 'inline-block',
                transition: 'background 0.3s',
              }}
            />
            <span style={{ color: isPlaying ? '#22c55e' : '#64748b' }}>
              {isPlaying ? 'ENGINE ACTIVE' : 'STANDBY'}
            </span>
          </div>
          <button
            style={{
              padding: '6px 14px',
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 4,
              color: '#94a3b8',
              fontSize: 10,
              fontFamily: 'inherit',
              cursor: 'pointer',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            Export Data
          </button>
        </div>
      </header>

      {/* Main */}
      <main style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left Controls */}
        <aside
          style={{
            width: 240,
            flexShrink: 0,
            background: '#0f172a',
            borderRight: '1px solid #1e293b',
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            overflowY: 'auto',
          }}
        >
          {/* Sliders */}
          <div>
            <p style={sectionLabel}>Primary Parameters</p>

            {/* Voltage */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={paramName}>Voltage</span>
                <span style={paramVal}>{params.voltage.toFixed(2)} V</span>
              </div>
              <input
                type="range"
                min={2.0}
                max={4.0}
                step={0.01}
                value={params.voltage}
                onChange={e => setParams(p => ({ ...p, voltage: parseFloat(e.target.value) }))}
                style={{ width: '100%', accentColor: '#3b82f6' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#334155', marginTop: 2 }}>
                <span>2.0 V</span><span>4.0 V</span>
              </div>
            </div>

            {/* Frequency */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={paramName}>Frequency</span>
                <span style={paramVal}>{freqDisplay}</span>
              </div>
              <input
                type="range"
                min={100}
                max={5000}
                step={100}
                value={params.frequency}
                onChange={e => setParams(p => ({ ...p, frequency: parseInt(e.target.value) }))}
                style={{ width: '100%', accentColor: '#3b82f6' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#334155', marginTop: 2 }}>
                <span>100 Hz</span><span>5 kHz</span>
              </div>
            </div>

            {/* Amplitude */}
            <div style={{ marginBottom: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={paramName}>Amplitude</span>
                <span style={paramVal}>{params.amplitude}%</span>
              </div>
              <input
                type="range"
                min={10}
                max={90}
                step={1}
                value={params.amplitude}
                onChange={e => setParams(p => ({ ...p, amplitude: parseInt(e.target.value) }))}
                style={{ width: '100%', accentColor: '#3b82f6' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#334155', marginTop: 2 }}>
                <span>10%</span><span>90%</span>
              </div>
            </div>
          </div>

          {/* Constants */}
          <div>
            <p style={sectionLabel}>Operational Constants</p>
            <div style={{ background: 'rgba(2,6,23,0.5)', border: '1px solid #1e293b', borderRadius: 6, padding: '10px 12px' }}>
              {[
                ['Print Speed', '20.0 mm/s'],
                ['Material', 'AgCite 90072'],
                ['Nozzle Tip', '50µm Ruby'],
                ['Substrate', 'Glass / FR4'],
              ].map(([label, val]) => (
                <div
                  key={label}
                  style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #1e293b' }}
                >
                  <span style={{ fontSize: 10, color: '#475569' }}>{label}</span>
                  <span style={{ fontSize: 10, color: label === 'Material' ? '#60a5fa' : '#94a3b8', fontWeight: 700 }}>{val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Buttons */}
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button onClick={togglePlay} style={primaryBtn}>
              {isPlaying ? <Pause size={13} /> : <Play size={13} />}
              {isPlaying ? 'PAUSE JETTING' : 'INITIATE JETTING'}
            </button>
            <button onClick={handleReset} style={secondaryBtn}>
              <RotateCcw size={13} />
              RESET
            </button>
          </div>
        </aside>

        {/* Viewport */}
        <section
          ref={viewportRef}
          style={{ flex: 1, position: 'relative', background: '#020617', overflow: 'hidden' }}
        >
          {/* Grid overlay */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              opacity: 0.18,
              backgroundImage: 'radial-gradient(circle, #334155 1px, transparent 1px)',
              backgroundSize: '30px 30px',
              pointerEvents: 'none',
            }}
          />

          {/* Sim canvas */}
          <canvas
            ref={simCanvasRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          />

          {/* Nozzle */}
          <div
            style={{
              position: 'absolute',
              left: '8%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 10,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                border: '3px solid #1e293b',
                background: '#0f172a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 20px rgba(59,130,246,0.15)',
              }}
            >
              <div
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: '#3b82f6',
                  boxShadow: isPlaying ? '0 0 10px rgba(59,130,246,0.9)' : 'none',
                  transition: 'box-shadow 0.3s',
                }}
              />
            </div>
            <span
              style={{
                fontSize: 7,
                color: '#475569',
                marginTop: 5,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              Print Head [X-Y]
            </span>
          </div>

          {/* Telemetry chips */}
          <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 8, zIndex: 10 }}>
            {[
              { label: 'Re Number', value: '2.18', unit: 'Re' },
              { label: 'Trace Acc.', value: traceAcc, unit: '%' },
            ].map(chip => (
              <div
                key={chip.label}
                style={{
                  background: 'rgba(15,23,42,0.88)',
                  border: '1px solid #1e293b',
                  borderRadius: 7,
                  padding: '7px 12px',
                  backdropFilter: 'blur(4px)',
                }}
              >
                <p style={{ fontSize: 8, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>
                  {chip.label}
                </p>
                <p style={{ fontSize: 18, color: '#38bdf8', fontWeight: 700 }}>
                  {chip.value}
                  <span style={{ fontSize: 9, color: '#334155', marginLeft: 2 }}>{chip.unit}</span>
                </p>
              </div>
            ))}
          </div>

          {/* Scale reference */}
          <div style={{ position: 'absolute', bottom: 12, right: 12, opacity: 0.4, zIndex: 5 }}>
            <div style={{ width: 60, height: 1, background: '#475569' }} />
            <p style={{ fontSize: 8, color: '#475569', marginTop: 3, textAlign: 'right' }}>300µm ref</p>
          </div>
        </section>

        {/* Right Analytics */}
        <aside
          style={{
            width: 210,
            flexShrink: 0,
            background: '#0f172a',
            borderLeft: '1px solid #1e293b',
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            overflowY: 'auto',
          }}
        >
          <p style={sectionLabel}>Predictive Analytics</p>

          {/* Main KPI */}
          <div style={kpiCard}>
            <p style={{ fontSize: 9, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
              Est. Droplet Area
            </p>
            <p style={{ fontSize: 26, color: '#f1f5f9', fontWeight: 700 }}>
              {areaK.toLocaleString()}
              <span style={{ fontSize: 11, color: '#3b82f6', marginLeft: 3 }}>×10³ µm²</span>
            </p>
            <p style={{ fontSize: 9, color: '#475569', marginTop: 2 }}>≈ {areaMM} mm²</p>
          </div>

          {/* Confidence */}
          <div>
            <p style={sectionLabel}>Model Confidence</p>
            <p style={{ fontSize: 10, color: '#64748b', marginBottom: 5 }}>
              {conf}% — IDW interpolation
            </p>
            <div style={{ height: 3, borderRadius: 2, background: '#1e293b', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${conf}%`,
                  borderRadius: 2,
                  background: confColor,
                  transition: 'width 0.4s, background 0.4s',
                }}
              />
            </div>
          </div>

          {/* Nearest lab sample */}
          <div>
            <p style={sectionLabel}>Nearest Lab Sample</p>
            <div style={kpiCard}>
              {[
                ['Sample', `#${n.sample}`],
                ['Frequency', nearFreqDisplay],
                ['Voltage', `${n.v.toFixed(2)} V`],
                ['Amplitude', `${n.a}%`],
                ['Measured', `${Math.round(n.area / 1000).toLocaleString()} ×10³ µm²`],
              ].map(([label, val]) => (
                <div
                  key={label}
                  style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}
                >
                  <span style={{ fontSize: 9, color: '#475569' }}>{label}</span>
                  <span style={{ fontSize: 9, color: label === 'Measured' ? '#22c55e' : '#94a3b8', fontWeight: label === 'Measured' ? 700 : 400 }}>
                    {val}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Microscope */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <p style={{ ...sectionLabel, margin: 0 }}>Microscope View</p>
              <span style={{ fontSize: 8, color: '#475569' }}>×20.0 MAG</span>
            </div>
            <div
              style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '1',
                border: '1px solid #1e293b',
                borderRadius: 7,
                overflow: 'hidden',
                cursor: 'crosshair',
              }}
            >
              <canvas
                ref={microCanvasRef}
                width={180}
                height={180}
                style={{ width: '100%', height: '100%' }}
              />
              <span
                style={{
                  position: 'absolute',
                  top: 5,
                  right: 6,
                  fontSize: 7,
                  color: '#475569',
                  background: 'rgba(0,0,0,0.5)',
                  padding: '1px 4px',
                  borderRadius: 2,
                }}
              >
                LIVE
              </span>
            </div>
          </div>

          {/* Insight */}
          <div
            style={{
              background: '#0c1a2e',
              borderLeft: '2px solid #3b82f6',
              borderRadius: '0 4px 4px 0',
              padding: '8px 10px',
            }}
          >
            <p style={{ fontSize: 9, color: '#3b82f6', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 4, textTransform: 'uppercase' }}>
              Model Insight
            </p>
            <p style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.5 }}>{insight}</p>
          </div>
        </aside>
      </main>

      {/* Footer */}
      <footer
        style={{
          height: 30,
          flexShrink: 0,
          background: '#0f172a',
          borderTop: '1px solid #1e293b',
          padding: '0 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', gap: 24 }}>
          <span style={footerTxt}>● SYSTEM: NOMINAL</span>
          <span style={footerTxt}>LAT: 12ms</span>
          <span style={{ ...footerTxt, color: '#1e293b' }}>BUF: 94%</span>
        </div>
        <span style={footerTxt}>
          SEED: <span style={{ color: '#3b82f6' }}>0x77AF2B9</span>
        </span>
      </footer>
    </div>
  );
}

// --- Style constants ---

const sectionLabel: React.CSSProperties = {
  fontSize: 9,
  color: '#475569',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  marginBottom: 8,
  fontWeight: 500,
};

const paramName: React.CSSProperties = {
  fontSize: 11,
  color: '#94a3b8',
};

const paramVal: React.CSSProperties = {
  fontSize: 11,
  color: '#38bdf8',
  fontWeight: 700,
};

const kpiCard: React.CSSProperties = {
  background: 'rgba(2,6,23,0.6)',
  border: '1px solid #1e293b',
  borderRadius: 6,
  padding: '10px 12px',
};

const primaryBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  width: '100%',
  padding: '10px 0',
  background: '#1d4ed8',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  fontSize: 10,
  fontFamily: 'ui-monospace, monospace',
  letterSpacing: '0.12em',
  cursor: 'pointer',
  fontWeight: 700,
  textTransform: 'uppercase' as const,
};

const secondaryBtn: React.CSSProperties = {
  ...primaryBtn,
  background: '#1e293b',
  color: '#94a3b8',
  border: '1px solid #334155',
};

const footerTxt: React.CSSProperties = {
  fontSize: 8,
  color: '#334155',
  letterSpacing: '0.1em',
};
