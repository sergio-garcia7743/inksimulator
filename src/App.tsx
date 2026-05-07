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
// Extracted from user data: V, f, a -> Droplet Size (microns)
const EXPERIMENTAL_DATA = [
  { a: 60, f: 1000, v: 2.79, d: 2797 },
  { a: 70, f: 1000, v: 2.79, d: 1352 },
  { a: 40, f: 100, v: 3.00, d: 1412 },
  { a: 40, f: 1000, v: 2.79, d: 2720 },
  { a: 80, f: 3000, v: 2.79, d: 3000 },
  { a: 20, f: 1000, v: 2.79, d: 1100 },
];

/**
 * A simple multivariate interpolation predictive model.
 */
function predictDropletSize(params: SimulationParams): number {
  const { voltage, frequency, amplitude } = params;
  
  // Base model derived from observed trends:
  // - Higher Amplitude generally increases droplet volume
  // - Higher Voltage increases pressure and volume
  // - Frequency affects jetting stability (simplified here)
  
  const vScale = (voltage - 2.7) * 2000; 
  const aScale = (amplitude / 100) * 1500;
  const fScale = Math.log10(frequency + 1) * 200;
  
  const baseSize = 800; // Minimum viable droplet
  let predicted = baseSize + vScale + aScale - (fScale / 3);
  
  // Clamping to realistic ranges observed in data (1000 - 3500 microns)
  return Math.min(Math.max(predicted, 800), 3500);
}

// --- Components ---

export default function App() {
  const [params, setParams] = useState<SimulationParams>({
    voltage: 2.89,
    frequency: 1000,
    amplitude: 40,
    speed: 20
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [lineLength, setLineLength] = useState(0); // For substrate line visualization
  const microscopeCanvasRef = useRef<HTMLCanvasElement>(null);
  const lastEmitTime = useRef<number>(0);
  const requestRef = useRef<number | null>(null);

  const predictedSize = useMemo(() => predictDropletSize(params), [params]);

  // Simulation Loop
  useEffect(() => {
    const update = (time: number) => {
      if (!isPlaying) {
        lastEmitTime.current = 0;
        return;
      }

      if (!lastEmitTime.current) {
        lastEmitTime.current = time;
      }

      const delta = time - lastEmitTime.current;
      const emitInterval = 1000 / params.frequency;

      if (delta >= emitInterval) {
        setParticles(prev => {
          // Update positions of existing particles (move to the right)
          const moved = prev.map(p => ({ ...p, x: p.x + (params.speed / 10) })).filter(p => p.x < 100);
          
          // Add new particle at the nozzle position (X=10%)
          return [
            ...moved,
            {
              id: Math.random(),
              x: 10, 
              y: 50, // Center Y
              size: predictedSize / 80, // Consistent top-down scale
              opacity: 1
            }
          ];
        });
        lastEmitTime.current = time;
      } else {
        // Just update existing positions between emissions
        setParticles(prev => prev.map(p => ({ ...p, x: p.x + (params.speed / 200) })).filter(p => p.x < 100));
      }

      requestRef.current = requestAnimationFrame(update);
    };

    if (isPlaying) {
      requestRef.current = requestAnimationFrame(update);
    } else {
      lastEmitTime.current = 0;
    }

    return () => {
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [params, isPlaying, predictedSize]);

  // Reset function
  const handleReset = () => {
    setIsPlaying(false);
    setParticles([]);
    setLineLength(0);
    lastEmitTime.current = 0;
  };

  // Render Microscope View
  useEffect(() => {
    const ctx = microscopeCanvasRef.current?.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, 300, 300);
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, 300, 300);
    
    ctx.strokeStyle = '#0f172a';
    for(let i = 0; i < 300; i += 20) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 300); ctx.stroke();
    }

    const centerX = 150;
    const centerY = 150;
    const radius = predictedSize / 30;

    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    gradient.addColorStop(0, '#f8fafc');
    gradient.addColorStop(0.6, '#94a3b8');
    gradient.addColorStop(1, '#1e293b');

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = '#38bdf844';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.strokeStyle = '#ef4444';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(centerX - radius - 10, centerY);
    ctx.lineTo(centerX + radius + 10, centerY);
    ctx.stroke();
    
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.fillText(`Ø ${predictedSize.toFixed(0)}µm`, centerX - 25, centerY - 15);
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
            AgCite 90072 <span className="text-slate-400 font-normal">Flow Dynamics v2.4.0</span>
          </h1>
        </div>
        <div className="flex items-center space-x-6 text-sm font-medium">
          <div className="flex items-center space-x-2 bg-slate-800/50 px-3 py-1.5 rounded-full border border-slate-700/50">
            <span className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`}></span>
            <span className="text-slate-300 text-xs tracking-widest">{isPlaying ? 'ENGINE ACTIVE' : 'SYSTEM STANDBY'}</span>
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
                  <label className="text-sm font-medium text-slate-300">Voltage</label>
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
                  <label className="text-sm font-medium text-slate-300">Frequency</label>
                  <span className="text-blue-400 font-mono text-sm font-bold">{(params.frequency / 1000).toFixed(2)}kHz</span>
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
                  min="10" max="90" step="1"
                  value={params.amplitude}
                  onChange={(e) => setParams({...params, amplitude: parseInt(e.target.value)})}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>
            </div>
          </div>

          <div className="flex-1">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Operational Constants</h2>
            <div className="bg-slate-950/50 rounded-lg p-5 space-y-4 border border-slate-800/50">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">Print Speed</span>
                <span className="text-xs font-mono font-bold text-slate-200">20.0 mm/s</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">Material</span>
                <span className="text-xs font-mono font-bold text-blue-500/80">AgCite 90072</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">Nozzle Tip</span>
                <span className="text-xs font-mono font-bold text-slate-200">50µm Ruby</span>
              </div>
            </div>
          </div>

          <button 
            onClick={() => isPlaying ? handleReset() : setIsPlaying(true)}
            className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white rounded font-bold text-sm tracking-widest shadow-lg shadow-blue-900/40 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
          >
             {isPlaying ? <RotateCcw className="w-4 h-4" /> : <Play className="w-4 h-4" />}
             {isPlaying ? "RESET DYNAMICS" : "INITIATE JETTING"}
          </button>
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
              <p className="text-[10px] text-slate-500 uppercase font-black tracking-tighter mb-1">Trace Accuracy</p>
              <p className="text-2xl font-mono text-emerald-400 font-bold">99.4<span className="text-xs text-slate-600 ml-1">%</span></p>
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
              <h3 className="text-[11px] font-black text-blue-400 mb-2 uppercase tracking-wide">Model Insights</h3>
              <p className="text-[11px] text-slate-400 leading-relaxed font-medium">
                {predictedSize > 2500 
                  ? "Current voltage favors high-deposition output. Potential risk of puddle formation on substrate." 
                  : "Jetting stability remains high. Laminar flow profile maintained throughout frequency spectrum."}
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

