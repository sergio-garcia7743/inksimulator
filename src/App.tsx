import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Activity, 
  Settings2, 
  Zap, 
  Waves, 
  Maximize2, 
  Info,
  Droplet,
  Play,
  RotateCcw,
  Microscope
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---

interface SimulationParams {
  voltage: number;
  frequency: number;
  amplitude: number;
  speed: number; // constant 20 mm/s
}

interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  opacity: number;
}

// --- Predictive Model Data ---
// Extracted from user data: Sample #, f, V, a
const SAMPLES = [
  { id: 1, f: 1000, v: 2.79, a: 60 },
  { id: 2, f: 1000, v: 2.79, a: 70 },
  { id: 3, f: 1500, v: 2.79, a: 70 },
  { id: 4, f: 2000, v: 2.79, a: 70 },
  { id: 9, f: 1000, v: 2.79, a: 20 },
  { id: 10, f: 2000, v: 2.79, a: 20 },
  { id: 13, f: 2000, v: 2.89, a: 40 },
  { id: 16, f: 500,  v: 2.89, a: 40 },
  { id: 17, f: 100,  v: 3.00, a: 40 },
];

/**
 * Recalibrated EHD model for AgCite 90072.
 * Target: Sample 9 (V=2.79, A=20, f=1kHz) -> d ~ 6um (Spacing 20um, 2 dots fit in gap)
 * Target: Sample 13 (V=2.89, A=40, f=2kHz) -> d ~ 10.5um (Spacing 10um, Line forms)
 */
function predictDropletSize(params: SimulationParams): number {
  const { voltage, frequency, amplitude } = params;
  
  const vNorm = voltage / 2.79;
  const aScale = 1 + (amplitude / 65);
  
  // Micro-scale diameters (microns)
  const baseDiameter = 5.2; 
  let diameter = baseDiameter * Math.pow(vNorm, 5) * aScale;
  
  // Frequency roll-off (refill bottleneck) affecting volume slightly
  if (frequency > 2400) {
    diameter -= (frequency - 2400) * 0.0012;
  }

  return Math.min(Math.max(diameter, 1.5), 20.0);
}

// --- Components ---

export default function App() {
  const [params, setParams] = useState<SimulationParams>({
    voltage: 2.89,
    frequency: 2000,
    amplitude: 40,
    speed: 20
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMoving, setIsMoving] = useState(false); // New: Tracks when Thorlabs motion starts
  const [sampleProgress, setSampleProgress] = useState(0); // 0-100mm
  const [particles, setParticles] = useState<Particle[]>([]);
  const microscopeCanvasRef = useRef<HTMLCanvasElement>(null);
  const lastEmitTime = useRef<number>(0);
  const startTime = useRef<number>(0);
  const requestRef = useRef<number | null>(null);

  const predictedSize = useMemo(() => predictDropletSize(params), [params]);

  // Constants
  const POOL_TIME = 850;
  const PRINT_SPEED_MM_S = 20;
  const SAMPLE_LIMIT_MM = 100; // 10cm
  const PRINT_DURATION_MS = (SAMPLE_LIMIT_MM / PRINT_SPEED_MM_S) * 1000;

  // Simulation Loop
  useEffect(() => {
    let lastFrameTime = performance.now();
    
    const update = (now: number) => {
      if (!isPlaying) {
        lastFrameTime = now;
        return;
      }

      const deltaTime = now - lastFrameTime;
      lastFrameTime = now;

      // Sequential Logic: 
      // 0-850ms: Energized & Stationary (Pooling)
      // >850ms: Thorlabs Motion Starts (Linear Sweep)
      const elapsed = now - startTime.current;

      // Stop if sample finished
      if (elapsed > POOL_TIME + PRINT_DURATION_MS) {
        setIsPlaying(false);
        setIsMoving(false);
        return;
      }

      const motionActive = elapsed > POOL_TIME;
      if (motionActive !== isMoving) setIsMoving(motionActive);

      // 1. Move existing particles
      // Visual Scaling for kHz frequencies (Visual Time Dilation)
      const VISUAL_TIME_SCALE = 0.04; 
      const visualSpeed = 55; 
      const moveAmount = motionActive ? (visualSpeed * deltaTime * VISUAL_TIME_SCALE) : 0;

      // Update physical progress
      if (motionActive) {
        setSampleProgress(prev => Math.min(prev + (PRINT_SPEED_MM_S * deltaTime / 1000), SAMPLE_LIMIT_MM));
      }

      const emitInterval = 1000 / (params.frequency * VISUAL_TIME_SCALE);
      const timeSinceLastEmit = now - lastEmitTime.current;

      setParticles(prev => {
        let updated = prev.map(p => ({ ...p, x: p.x + moveAmount })).filter(p => p.x < 118);

        if (timeSinceLastEmit >= emitInterval) {
          // Instability increases with both Voltage and Freq
          const instability = (params.frequency / 3500) * (params.voltage / 2.5);
          const jitter = params.frequency > 2200 ? (Math.random() - 0.5) * instability * 4 : 0;
          
          updated.push({
            id: Math.random(),
            x: 10,
            y: 50 + jitter,
            size: predictedSize * 2.4, 
            opacity: 1
          });
          lastEmitTime.current = now;
        }
        return updated;
      });

      requestRef.current = requestAnimationFrame(update);
    };

    if (isPlaying) {
      startTime.current = performance.now();
      lastEmitTime.current = performance.now();
      requestRef.current = requestAnimationFrame(update);
    }

    return () => {
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [params.frequency, isPlaying, predictedSize]);

  // Reset function
  const handleReset = () => {
    setIsPlaying(false);
    setIsMoving(false);
    setParticles([]);
    setSampleProgress(0);
    lastEmitTime.current = 0;
    startTime.current = 0;
  };

  // Set from library
  const loadSample = (s: typeof SAMPLES[0]) => {
    handleReset();
    setParams({
      ...params,
      frequency: s.f,
      voltage: s.v,
      amplitude: s.a
    });
  };

  // Render Microscope View
  useEffect(() => {
    const ctx = microscopeCanvasRef.current?.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, 300, 300);
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, 300, 300);
    
    // Grid
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1;
    for(let i = 0; i < 300; i += 20) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 300); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(300, i); ctx.stroke();
    }

    // Centered visualization of a single drop
    const centerX = 150;
    const centerY = 150;
    const radius = predictedSize * 6; // Zoomed in purely for visual diameter check

    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    gradient.addColorStop(0, '#f8fafc');
    gradient.addColorStop(0.6, '#3b82f6');
    gradient.addColorStop(1, '#1e293b');

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = '#38bdf888';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.strokeStyle = '#ef4444';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(centerX - radius - 15, centerY);
    ctx.lineTo(centerX + radius + 15, centerY);
    ctx.stroke();
    
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 12px ui-monospace, monospace';
    ctx.fillText(`Ø ${predictedSize.toFixed(2)}µm`, centerX - 30, centerY - 20);
  }, [predictedSize]);

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* Header */}
      <header className="h-16 shrink-0 border-b border-slate-800 bg-slate-900/50 px-6 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center shadow-lg shadow-blue-900/20">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            AgCite 90072 <span className="text-slate-400 font-normal">EHD Ejection Lab v3.0.1</span>
          </h1>
        </div>
        <div className="flex items-center space-x-6 text-sm font-medium">
          <div className="flex items-center space-x-2 bg-slate-800/50 px-3 py-1.5 rounded-full border border-slate-700/50">
            <span className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`}></span>
            <span className="text-slate-300 text-xs tracking-widest">{isPlaying ? 'FIELD ENERGIZED' : 'FIELD DISARMED'}</span>
          </div>
          <button className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-md border border-slate-700 transition-colors text-xs font-bold text-slate-300 tracking-wide uppercase">
            Export Data
          </button>
        </div>
      </header>

      {/* Main Interface */}
      <main className="flex-1 flex overflow-hidden">
        
        {/* Left Controls Panel */}
        <aside className="w-80 shrink-0 bg-slate-900 border-r border-slate-800 p-6 flex flex-col space-y-8 overflow-y-auto">
          <div>
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-6">Primary Parameters</h2>
            
            <div className="space-y-8">
              {/* Voltage Slider */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-slate-300">Voltage (V)</label>
                  <span className="text-blue-400 font-mono text-sm font-bold">{params.voltage.toFixed(2)}V</span>
                </div>
                <input 
                  type="range" 
                  min="2.0" max="4.0" step="0.01"
                  value={params.voltage}
                  onChange={(e) => setParams({...params, voltage: parseFloat(e.target.value)})}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>

              {/* Frequency Slider */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-slate-300">Frequency (f)</label>
                  <span className="text-blue-400 font-mono text-sm font-bold font-mono">{(params.frequency / 1000).toFixed(2)}kHz</span>
                </div>
                <input 
                  type="range" 
                  min="100" max="5000" step="100"
                  value={params.frequency}
                  onChange={(e) => setParams({...params, frequency: parseInt(e.target.value)})}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>

              {/* Amplitude Slider */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-slate-300">Amplitude</label>
                  <span className="text-blue-400 font-mono text-sm font-bold">{params.amplitude}%</span>
                </div>
                <input 
                  type="range" 
                  min="10" max="95" step="1"
                  value={params.amplitude}
                  onChange={(e) => setParams({...params, amplitude: parseInt(e.target.value)})}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>
            </div>
          </div>

          <div>
             <h2 className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-4">Sample Library</h2>
             <div className="grid grid-cols-4 gap-2">
                {SAMPLES.map(s => (
                  <button 
                    key={s.id}
                    onClick={() => loadSample(s)}
                    className="p-2 bg-slate-950 border border-slate-800 rounded text-[10px] font-mono hover:border-blue-500 transition-colors text-slate-400 hover:text-blue-400"
                  >
                    #{s.id}
                  </button>
                ))}
             </div>
          </div>

          <div className="flex-1">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">EHD Infrastructure</h2>
            <div className="bg-slate-950/50 rounded-lg p-5 space-y-4 border border-slate-800/50">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">Stage Position</span>
                <span className="text-xs font-mono font-bold text-slate-200">{sampleProgress.toFixed(1)}mm / 100</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">LiteTouch Supply</span>
                <span className="text-xs font-mono font-bold text-blue-500/80">PRESSURE_LOCK</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">Thorlabs Control</span>
                <span className="text-xs font-mono font-bold text-slate-200">LTS-150 ACTIVATED</span>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button 
              onClick={handleReset}
              className="px-4 py-4 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-bold text-xs tracking-widest transition-all active:scale-[0.98] border border-slate-700"
            >
               <RotateCcw className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setIsPlaying(true)}
              disabled={isPlaying}
              className={`flex-1 py-4 ${isPlaying ? 'bg-blue-900/50 text-blue-500' : 'bg-blue-600 hover:bg-blue-500 text-white'} rounded font-bold text-sm tracking-widest shadow-lg shadow-blue-900/40 transition-all active:scale-[0.98] flex items-center justify-center gap-2`}
            >
               {isPlaying ? <Activity className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
               {isPlaying ? "PRINTING SAMPLE..." : "START 10cm PRINT"}
            </button>
          </div>
        </aside>

        {/* Simulation Viewport */}
        <section className="flex-1 bg-slate-950 relative flex flex-col items-center justify-center overflow-hidden">
          {/* Simulation Grid Overlay (Substrate) */}
          <div className="absolute inset-0 opacity-40 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, #1e293b 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
          
          {/* Top-Down Particles Rendering */}
          <div className="absolute inset-0 z-10">
            {particles.map(p => (
              <motion.div
                key={p.id}
                className="absolute bg-blue-400 rounded-full"
                style={{ 
                  left: `${p.x}%`,
                  top: `${p.y}%`,
                  width: p.size, 
                  height: p.size,
                  transform: 'translate(-50%, -50%)',
                  boxShadow: '0 0 10px rgba(96, 165, 250, 0.4)',
                  filter: 'blur(0.2px)'
                }}
              />
            ))}
          </div>

          {/* Nozzle Header (Top POV) */}
          <div className="absolute left-[10%] top-1/2 -translate-y-1/2 -translate-x-1/2 z-20 flex flex-col items-center">
            <div className="w-16 h-16 rounded-full border-4 border-slate-700 bg-slate-900 flex items-center justify-center shadow-2xl ring-8 ring-blue-500/10">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.8)]" />
            </div>
            <span className="text-[8px] font-mono text-slate-500 mt-3 uppercase tracking-widest whitespace-nowrap">Print Head [X-Y POV]</span>
          </div>

          {/* Scale Overlay */}
          <div className="absolute bottom-8 right-8 flex flex-col items-end opacity-40">
            <div className="w-24 h-0.5 bg-slate-600" />
            <span className="text-[10px] font-mono text-slate-500 mt-1 uppercase tracking-widest">300µm Reference Scale</span>
          </div>

          {/* Telemetry Overlays */}
          <div className="absolute top-8 left-8 flex gap-4">
            <div className="bg-slate-900/80 backdrop-blur-xl p-4 border border-slate-700 rounded-xl shadow-2xl">
              <p className="text-[10px] text-slate-500 uppercase font-black tracking-tighter mb-1">Reynolds Number</p>
              <p className="text-2xl font-mono text-blue-400 font-bold">2.18<span className="text-xs text-slate-600 ml-1">Re</span></p>
            </div>
            <div className="bg-slate-900/80 backdrop-blur-xl p-4 border border-slate-700 rounded-xl shadow-2xl">
               <p className="text-[10px] text-slate-500 uppercase font-black tracking-tighter mb-1">Stage Status</p>
               <p className="text-2xl font-mono text-emerald-400 font-bold">{isMoving ? "SWEEPING" : "STATIONARY"}</p>
            </div>
          </div>
        </section>

        {/* Right Analytics Panel */}
        <aside className="w-80 shrink-0 bg-slate-900 border-l border-slate-800 p-6 space-y-8 overflow-y-auto">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-6">Predictive Analytics</h2>
          
          <div className="space-y-8">
            {/* Main KPI */}
            <div className="space-y-2">
              <p className="text-xs text-slate-400 font-medium">Est. Droplet Diameter</p>
              <div className="flex items-baseline gap-1">
                <p className="text-4xl font-mono font-bold text-slate-100 tabular-nums">
                    {predictedSize.toFixed(0)}
                </p>
                <span className="text-lg font-mono text-blue-500/60 font-bold">µm</span>
              </div>
            </div>

            {/* Stability Forecast Chart Mockup */}
            <div className="space-y-3">
              <p className="text-xs text-slate-400 font-medium">Drop Stability Flux</p>
              <div className="h-28 w-full bg-slate-950 rounded-lg border border-slate-800/80 flex items-end p-2 space-x-1 shadow-inner relative">
                {[30, 45, 60, 85, 70, 40, 55, 30].map((h, i) => (
                    <motion.div 
                        key={i}
                        className={`flex-1 rounded-sm ${h > 75 ? 'bg-orange-500/80' : 'bg-blue-600/60'}`}
                        initial={{ height: 0 }}
                        animate={{ height: `${h}%` }}
                        transition={{ delay: i * 0.05 }}
                    />
                ))}
                <div className="absolute top-1/2 left-0 w-full h-[1px] bg-slate-800 border-dashed" />
              </div>
              <div className="flex justify-between text-[9px] text-slate-600 font-mono tracking-tighter">
                <span>START</span><span>JETTING_CYCLES</span><span>PEAK</span>
              </div>
            </div>

            {/* Microscope Integration */}
            <div className="space-y-4">
               <div className="flex justify-between items-center">
                 <p className="text-xs text-slate-400 font-medium tracking-tight">Microscope Analysis</p>
                 <span className="text-[9px] text-slate-600 font-mono">X20.0 MAG</span>
               </div>
               <div className="relative aspect-square w-full rounded-2xl border-2 border-slate-800 overflow-hidden shadow-2xl group cursor-crosshair">
                  <canvas ref={microscopeCanvasRef} width={300} height={300} className="w-full h-full scale-[1.02] group-hover:scale-110 transition-transform duration-700" />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/40 to-transparent pointer-events-none" />
                  <div className="absolute top-3 right-3 text-[8px] font-mono text-slate-600 bg-black/40 px-1.5 py-0.5 rounded backdrop-blur-sm">LIVE_FEED</div>
               </div>
            </div>

            {/* Insights Module */}
            <div className="p-5 border-l-2 border-blue-500 bg-blue-500/5 rounded-r-xl">
              <h3 className="text-[11px] font-black text-blue-400 mb-2 uppercase tracking-wide">EHD Predictive Insights</h3>
              <p className="text-[11px] text-slate-400 leading-relaxed font-medium">
                {params.frequency > 4000 
                  ? "CRITICAL: Pulse frequency exceeds LiteTouch syringe refill rate. Meniscus recovery is incomplete, leading to significant volume drop-off and field-ejection instability." 
                  : params.frequency > 2800
                  ? "CAUTION: Meniscus recovery time is narrowing. High-frequency pulses are deforming the ink before the meniscus fully stabilizes from previous ejection."
                  : "STABLE: Equilibrium reached between electric field strength and meniscus reformation. AgCite 90072 ejection remains laminar and consistent."}
              </p>
            </div>
          </div>
        </aside>
      </main>

      {/* Footer Status Bar */}
      <footer className="h-10 shrink-0 bg-slate-900 border-t border-slate-800 px-6 flex items-center justify-between text-[10px] font-mono text-slate-500 tracking-wider">
        <div className="flex space-x-10">
          <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span> SYSTEM: NORMAL</span>
          <span className="flex items-center gap-2 font-bold uppercase tracking-tighter">Lat: 12ms</span>
          <span className="flex items-center gap-2 text-slate-600">Buffer: 94% Capacity</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-slate-700 hidden sm:inline">// END_POINT_ACTIVE</span>
          <span className="text-slate-300">SEED: <span className="text-blue-500">0x77AF2B9</span></span>
        </div>
      </footer>
    </div>
  );
}

