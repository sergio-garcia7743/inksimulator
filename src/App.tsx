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
  { id: 1, f: 1000, v: 2.79, a: 60, blob: true, desc: "Large starting blob, then medium droplets" },
  { id: 2, f: 1000, v: 2.81, a: 70, blob: false, desc: "Medium-to-large droplets, tight spacing" },
  { id: 3, f: 1500, v: 2.79, a: 70, blob: false, desc: "Medium droplets, medium spacing" },
  { id: 4, f: 2000, v: 2.79, a: 70, blob: false, desc: "Large droplets, wide spacing" },
  { id: 5, f: 2500, v: 2.79, a: 60, blob: false, desc: "Small-to-medium droplets, tight spacing" },
  { id: 6, f: 3000, v: 2.82, a: 80, blob: false, continuous: true, desc: "Weak connected trace (smear effect)" },
  { id: 7, f: 3500, v: 2.79, a: 70, blob: false, desc: "Small-to-medium droplets, tight and regular" },
  { id: 8, f: 1200, v: 2.85, a: 90, blob: true, puddle: true, desc: "XL starting puddle, then medium droplets" },
  { id: 9, f: 1000, v: 2.79, a: 20, blob: false, desc: "Large droplets, very wide spacing" },
  { id: 10, f: 2000, v: 2.79, a: 20, blob: false, desc: "Medium-to-large droplets, wide spacing" },
  { id: 11, f: 1500, v: 2.89, a: 30, blob: true, desc: "Large starting blob, then large droplets" },
  { id: 12, f: 1800, v: 2.87, a: 50, blob: false, desc: "Medium-to-large droplets, medium spacing" },
  { id: 13, f: 2000, v: 2.89, a: 40, blob: true, puddle: true, continuous: true, desc: "XL starting puddle, then connected line" },
  { id: 14, f: 2500, v: 2.85, a: 60, blob: false, desc: "Medium droplets, tight spacing" },
  { id: 15, f: 3000, v: 2.82, a: 70, blob: true, puddle: true, desc: "XL starting puddle, then small droplets" },
  { id: 16, f: 500,  v: 2.89, a: 40, blob: true, desc: "Large starting blob, then small-to-medium" },
];

/**
 * Predicts droplet diameter in microns.
 * Calibrated against physical AgCite 90072 results.
 */
function predictDropletSize(params: SimulationParams): number {
  const { voltage, frequency, amplitude } = params;
  
  // High sensitivity to Voltage (Power-law relationship)
  const vFactor = Math.pow(voltage / 2.79, 7.5); 
  const aFactor = 1 + (amplitude / 85);
  
  // Base diameter target: ~10um for baseline
  let diameter = 8.5 * vFactor * aFactor;
  
  // Frequency roll-off (refill bottleneck)
  if (frequency > 2200) {
    diameter -= (frequency - 2200) * 0.0015;
  }

  return Math.min(Math.max(diameter, 1.2), 28.0);
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
  const [activeSample, setActiveSample] = useState<typeof SAMPLES[0] | null>(null);
  const [sampleProgress, setSampleProgress] = useState(0); // 0-100mm
  const [particles, setParticles] = useState<Particle[]>([]);
  const microscopeCanvasRef = useRef<HTMLCanvasElement>(null);
  const lastEmitTime = useRef<number>(0);
  const startTime = useRef<number>(0);
  const requestRef = useRef<number | null>(null);

  const predictedSize = useMemo(() => predictDropletSize(params), [params]);

  // Constants for Physical/Visual Calibration
  const PRINT_SPEED_MM_S = 20;
  
  // Spacing & Sprawl Calibration
  // VISUAL_SPEED tuned so 2000Hz is separated, but Sample 13's boost forces connection
  const VISUAL_TIME_SCALE = 0.04; 
  const BASE_VISUAL_SPEED = 12.0;        
  const VISUAL_PARTICLE_SCALE = 0.85; 

  // Simulation Loop
  useEffect(() => {
    let lastFrameTime = performance.now();
    
    const update = (now: number) => {
      const deltaTime = now - lastFrameTime;
      lastFrameTime = now;

      if (!isPlaying) return;

      const elapsed = now - startTime.current;

      // Dynamic speed based on sample type to ensure continuity where needed
      // 0.2 multiplier ensures droplets overlap for samples marked as continuous
      const speedMultiplier = activeSample?.continuous ? 0.2 : 1.0;
      const moveAmount = (BASE_VISUAL_SPEED * speedMultiplier * deltaTime * VISUAL_TIME_SCALE);
      setSampleProgress(prev => prev + (PRINT_SPEED_MM_S * deltaTime / 1000));

      const emitInterval = 1000 / (params.frequency * VISUAL_TIME_SCALE);
      
      setParticles(prev => {
        // Update both position AND size for 'live' slider feedback
        let updated = prev.map(p => ({ 
          ...p, 
          x: p.x + moveAmount,
          size: p.size // Keep existing size if we already calculated it on creation
        })).filter(p => p.x < 130);
        
        // Handle emission with catch-up for high frequencies
        let timeRange = now - lastEmitTime.current;
        if (timeRange >= emitInterval) {
          const numToEmit = Math.min(Math.floor(timeRange / emitInterval), 10);
          
          for (let i = 0; i < numToEmit; i++) {
            // Logic for STARTING BLOBS / PUDDLES
            let transientScale = 1.0;
            if (activeSample?.blob && elapsed < 1200) transientScale = 1.8;
            if (activeSample?.puddle && elapsed < 2000) transientScale = 2.6;
            
            // Continuous samples get a significant size boost to ensure overlap at lower speed
            if (activeSample?.continuous) transientScale *= 1.6;

            updated.push({
              id: Math.random() + i,
              x: 15 - (i * moveAmount / Math.max(numToEmit, 1)),
              y: 50,
              size: Math.max(predictedSize * VISUAL_PARTICLE_SCALE * transientScale, 2.0),
              opacity: 1
            });
          }
          lastEmitTime.current = now;
        }
        return updated;
      });

      requestRef.current = requestAnimationFrame(update);
    };

    if (isPlaying) {
      if (startTime.current === 0) startTime.current = performance.now();
      if (lastEmitTime.current === 0) lastEmitTime.current = performance.now();
      requestRef.current = requestAnimationFrame(update);
    }

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying, params.frequency, params.voltage, predictedSize, activeSample]);

  // Reset function
  const handleReset = () => {
    setIsPlaying(false);
    setParticles([]);
    setSampleProgress(0);
    lastEmitTime.current = 0;
    startTime.current = 0;
  };

  // Set from library
  const loadSample = (s: typeof SAMPLES[0]) => {
    handleReset();
    setActiveSample(s);
    setParams({
      voltage: s.v,
      frequency: s.f,
      amplitude: s.a,
      speed: 20
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
    <div className="flex flex-col min-h-screen lg:h-screen bg-slate-950 text-slate-100 font-sans overflow-x-hidden">
      {/* Header */}
      <header className="h-16 shrink-0 border-b border-slate-800 bg-slate-900/50 px-4 lg:px-6 flex items-center justify-between sticky top-0 z-50 backdrop-blur-md">
        <div className="flex items-center space-x-4">
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center shadow-lg shadow-blue-900/20">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            EHD Printing <span className="text-slate-400 font-normal">Simulator</span>
          </h1>
        </div>
        <div className="flex items-center space-x-6 text-sm font-medium">
          <div className="flex items-center space-x-2 bg-slate-800/50 px-3 py-1.5 rounded-full border border-slate-700/50">
            <span className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`}></span>
            <span className="text-slate-300 text-[10px] tracking-widest font-bold uppercase">{isPlaying ? 'JETTING' : 'IDLE'}</span>
          </div>
        </div>
      </header>

      {/* Main Interface */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        
        {/* Simulation Viewport (Prioritized on Mobile) */}
        <section className="h-[45vh] lg:h-auto lg:flex-1 shrink-0 bg-slate-950 relative flex flex-col items-center justify-center overflow-hidden border-b lg:border-b-0 border-slate-800 order-1 lg:order-2">
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
            <div className="w-12 h-12 lg:w-16 lg:h-16 rounded-full border-4 border-slate-700 bg-slate-900 flex items-center justify-center shadow-2xl ring-8 ring-blue-500/10">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.8)]" />
            </div>
          </div>
          
          {/* Mobile Overlay Stats */}
          <div className="lg:hidden absolute bottom-4 left-4 right-4 flex justify-between items-center pointer-events-none">
             <div className="bg-slate-900/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-slate-800 text-[10px] font-mono">
                <span className="text-slate-500">DIAMETER:</span> <span className="text-blue-400 font-bold">{predictedSize.toFixed(1)}µm</span>
             </div>
             <div className="bg-slate-900/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-slate-800 text-[10px] font-mono">
                <span className="text-slate-500">TRACE:</span> <span className="text-blue-400 font-bold">{sampleProgress.toFixed(1)}mm</span>
             </div>
          </div>
        </section>

        {/* Left Controls Panel */}
        <aside className="w-full lg:w-80 shrink-0 bg-slate-900 border-r border-slate-800 p-6 flex flex-col space-y-8 lg:overflow-y-auto order-2 lg:order-1">
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
              <div className="space-y-4 pt-4 border-t border-slate-800/50">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Waves className="w-4 h-4 text-slate-500" />
                    <label className="text-sm font-medium text-slate-300">Amplitude</label>
                  </div>
                  <span className="text-blue-400 font-mono text-sm font-bold bg-blue-500/10 px-2 py-0.5 rounded">{params.amplitude}%</span>
                </div>
                <div className="relative flex items-center">
                  <input 
                    type="range" 
                    min="10" max="95" step="1"
                    value={params.amplitude}
                    onChange={(e) => setParams({...params, amplitude: parseInt(e.target.value)})}
                    className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500 z-10"
                  />
                  <div 
                    className="absolute h-1.5 bg-blue-600 rounded-l-lg pointer-events-none" 
                    style={{ width: `${((params.amplitude - 10) / 85) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between text-[9px] text-slate-600 font-bold uppercase tracking-tighter px-1">
                  <span>Low</span>
                  <span>Optimal</span>
                  <span>High</span>
                </div>
              </div>
            </div>
          </div>

          <div>
             <h2 className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-4">Sample Library</h2>
             <div className="grid grid-cols-4 gap-2">
                {SAMPLES.map(s => (
                  <button 
                    key={s.id}
                    title={s.desc}
                    onClick={() => loadSample(s)}
                    className={`p-2 border rounded text-[10px] font-mono transition-all group relative ${
                      activeSample?.id === s.id 
                        ? 'bg-blue-600 border-blue-400 text-white shadow-lg shadow-blue-900/40' 
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-blue-500 hover:text-blue-400'
                    }`}
                  >
                    #{s.id}
                  </button>
                ))}
             </div>
             {activeSample && (
               <p className="mt-4 text-[10px] text-slate-500 italic leading-tight animate-in fade-in transition-all">
                 {activeSample.desc}
               </p>
             )}
          </div>

          <div className="pt-4 flex flex-col gap-3 mt-auto">
            <button 
              onClick={() => setIsPlaying(!isPlaying)}
              className={`w-full py-6 rounded-2xl font-black text-sm tracking-[0.25em] transition-all active:scale-[0.98] shadow-2xl flex items-center justify-center gap-4 ${
                isPlaying 
                  ? 'bg-red-500/10 text-red-500 border-2 border-red-500/50 hover:bg-red-500/20' 
                  : 'bg-blue-600 text-white border-2 border-blue-400 hover:bg-blue-500 hover:shadow-blue-500/50'
              }`}
            >
              {isPlaying ? <RotateCcw className="w-6 h-6 animate-spin-slow" /> : <Play className="w-6 h-6 fill-current" />}
              {isPlaying ? "STOP JETTING" : "START JETTING"}
            </button>
            
            <button 
              onClick={handleReset}
              className="w-full py-3 bg-slate-800/50 hover:bg-slate-700 text-slate-500 hover:text-slate-300 rounded-xl text-[10px] font-bold tracking-widest transition-all uppercase border border-slate-700/50"
            >
              Clear Live Trace
            </button>
          </div>
        </aside>

        {/* Right Analytics Panel */}
        <aside className="w-full lg:w-80 shrink-0 bg-slate-900 border-t lg:border-t-0 lg:border-l border-slate-800 p-6 space-y-8 lg:overflow-y-auto order-3">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-6">EHD Analytics</h2>
          
          <div className="space-y-10">
            {/* Main KPI */}
            <div className="space-y-4">
              <p className="text-xs text-slate-400 font-medium tracking-tight">Estimated Droplet Diameter</p>
              <div className="flex items-baseline gap-2">
                <p className="text-6xl font-mono font-bold text-slate-100 tabular-nums tracking-tighter">
                    {predictedSize.toFixed(1)}
                </p>
                <span className="text-xl font-mono text-blue-500/60 font-bold">µm</span>
              </div>
            </div>

            <div className="h-[1px] bg-slate-800" />
            
            {/* Microscopic Visualization */}
            <div className="space-y-4">
               <div className="flex justify-between items-center">
                 <p className="text-xs text-slate-400 font-medium tracking-tight">Ejection Profile</p>
                 <span className="text-[9px] text-slate-600 font-mono tracking-widest">REALTIME_SIM</span>
               </div>
               <div className="relative aspect-square w-full rounded-2xl border-2 border-slate-800 overflow-hidden shadow-2xl">
                  <canvas ref={microscopeCanvasRef} width={300} height={300} className="w-full h-full" />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/40 to-transparent pointer-events-none" />
               </div>
            </div>
          </div>
        </aside>
      </main>

      {/* Footer Status Bar */}
      <footer className="h-auto lg:h-10 shrink-0 bg-slate-900 border-t border-slate-800 px-6 py-3 lg:py-0 flex flex-col lg:flex-row items-center justify-between gap-2 text-[10px] font-mono text-slate-500 tracking-wider">
        <div className="flex space-x-6 lg:space-x-10">
          <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span> SYSTEM READY</span>
          <span className="text-slate-400 font-bold hidden lg:inline">TRACE_LEN: <span className="text-blue-400">{sampleProgress.toFixed(2)}mm</span></span>
        </div>
        <div className="flex items-center gap-6">
          <span className="text-slate-300 tracking-tighter uppercase font-bold">AgCite-90072-V3</span>
        </div>
      </footer>
    </div>
  );
}

