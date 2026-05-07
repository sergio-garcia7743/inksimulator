// /src/App.tsx

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Zap, 
  Play, 
  RotateCcw,
} from 'lucide-react';
import { motion } from 'motion/react';

// --- Types ---

interface SimulationParams {
  voltage: number;
  frequency: number;
  amplitude: number;
  speed: number; 
}

interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
}

// --- Predictive Model Data ---
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

function predictDropletSize(params: SimulationParams): number {
  const { voltage, frequency, amplitude } = params;
  const vFactor = Math.pow(voltage / 2.79, 7.5); 
  const aFactor = 1 + (amplitude / 85);
  let diameter = 8.5 * vFactor * aFactor;
  if (frequency > 2200) diameter -= (frequency - 2200) * 0.0015;
  return Math.min(Math.max(diameter, 1.2), 28.0);
}

export default function App() {
  const [params, setParams] = useState<SimulationParams>({
    voltage: 2.89, frequency: 2000, amplitude: 40, speed: 20
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [activeSample, setActiveSample] = useState<typeof SAMPLES[0] | null>(SAMPLES[12]);
  const [sampleProgress, setSampleProgress] = useState(0); 
  const [particles, setParticles] = useState<Particle[]>([]);
  const microscopeCanvasRef = useRef<HTMLCanvasElement>(null);
  const lastEmitTime = useRef<number>(0);
  const startTime = useRef<number>(0);
  const requestRef = useRef<number | null>(null);

  const predictedSize = useMemo(() => predictDropletSize(params), [params]);

  // Physical/Visual Calibration
  const VISUAL_TIME_SCALE = 0.05; 
  const VISUAL_SPEED = 9.0;        // Baseline speed
  const VISUAL_PARTICLE_SCALE = 3.5; // High scale value needed to close gaps on screen coordinates

  useEffect(() => {
    let lastFrameTime = performance.now();
    
    const update = (now: number) => {
      const deltaTime = now - lastFrameTime;
      lastFrameTime = now;

      if (!isPlaying) return;

      if (startTime.current === 0) startTime.current = now;
      const elapsed = now - startTime.current;

      const moveAmount = (VISUAL_SPEED * deltaTime * VISUAL_TIME_SCALE);
      setSampleProgress(prev => prev + (20 * deltaTime / 1000));

      const emitInterval = 1000 / (params.frequency * VISUAL_TIME_SCALE);
      
      setParticles(prev => {
        let updated = prev.map(p => ({ ...p, x: p.x + moveAmount })).filter(p => p.x < 130);
        
        let timeRange = now - lastEmitTime.current;
        if (timeRange >= emitInterval) {
          const numToEmit = Math.min(Math.floor(timeRange / emitInterval), 10);
          
          for (let i = 0; i < numToEmit; i++) {
            let transientScale = 1.0;
            if (activeSample?.blob && elapsed < 800) transientScale = 1.6;
            if (activeSample?.puddle && elapsed < 1500) transientScale = 2.2;
            if (activeSample?.continuous) transientScale *= 1.4;

            updated.push({
              id: Math.random() + i,
              x: 15 - (i * moveAmount / Math.max(numToEmit, 1)),
              y: 50,
              size: Math.max(predictedSize * VISUAL_PARTICLE_SCALE * transientScale, 2.5),
            });
          }
          lastEmitTime.current = now;
        }
        return updated;
      });

      requestRef.current = requestAnimationFrame(update);
    };

    if (isPlaying) {
      if (lastEmitTime.current === 0) lastEmitTime.current = performance.now();
      requestRef.current = requestAnimationFrame(update);
    }
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, [isPlaying, params.frequency, params.voltage, predictedSize, activeSample]);

  const handleReset = () => {
    setIsPlaying(false);
    setParticles([]);
    setSampleProgress(0);
    lastEmitTime.current = 0;
    startTime.current = 0;
  };

  const loadSample = (s: typeof SAMPLES[0]) => {
    handleReset();
    setActiveSample(s);
    setParams({ voltage: s.v, frequency: s.f, amplitude: s.a, speed: 20 });
  };

  useEffect(() => {
    const ctx = microscopeCanvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 300, 300);
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, 300, 300);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1;
    for(let i = 0; i < 300; i += 20) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 300); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(300, i); ctx.stroke();
    }
    const centerX = 150, centerY = 150;
    const radius = predictedSize * 6;
    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    gradient.addColorStop(0, '#f8fafc'); gradient.addColorStop(0.6, '#3b82f6'); gradient.addColorStop(1, '#1e293b');
    ctx.beginPath(); ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient; ctx.fill();
    ctx.strokeStyle = '#ef4444'; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(centerX - radius - 15, centerY); ctx.lineTo(centerX + radius + 15, centerY); ctx.stroke();
    ctx.fillStyle = '#ef4444'; ctx.font = 'bold 12px ui-monospace, monospace';
    ctx.fillText(`Ø ${predictedSize.toFixed(2)}µm`, centerX - 30, centerY - 20);
  }, [predictedSize]);

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      <header className="h-16 shrink-0 border-b border-slate-800 bg-slate-900/50 px-6 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center shadow-lg"><Zap className="w-5 h-5 text-white" /></div>
          <h1 className="text-xl font-semibold tracking-tight">EHD Printing <span className="text-slate-400 font-normal">Simulator</span></h1>
        </div>
        <div className="flex items-center space-x-2 bg-slate-800/50 px-3 py-1.5 rounded-full border border-slate-700/50">
          <span className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`}></span>
          <span className="text-slate-300 text-[10px] tracking-widest font-bold uppercase">{isPlaying ? 'JETTING' : 'IDLE'}</span>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        <aside className="w-80 shrink-0 bg-slate-900 border-r border-slate-800 p-6 flex flex-col space-y-8 overflow-y-auto">
          <div>
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-6">Primary Parameters</h2>
            <div className="space-y-8">
              <div className="space-y-4">
                <div className="flex justify-between items-center"><label className="text-sm font-medium text-slate-300">Voltage</label><span className="text-blue-400 font-mono text-sm font-bold">{params.voltage.toFixed(2)}V</span></div>
                <input type="range" min="2.0" max="3.5" step="0.01" value={params.voltage} onChange={(e) => setParams({...params, voltage: parseFloat(e.target.value)})} className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-center"><label className="text-sm font-medium text-slate-300">Frequency</label><span className="text-blue-400 font-mono text-sm font-bold">{(params.frequency / 1000).toFixed(2)}kHz</span></div>
                <input type="range" min="100" max="5000" step="100" value={params.frequency} onChange={(e) => setParams({...params, frequency: parseInt(e.target.value)})} className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
              </div>
            </div>
          </div>

          <div>
             <h2 className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-4">Sample Library</h2>
             <div className="grid grid-cols-4 gap-2">
                {SAMPLES.map(s => (
                  <button key={s.id} title={s.desc} onClick={() => loadSample(s)} className={`p-2 border rounded text-[10px] font-mono transition-all ${activeSample?.id === s.id ? 'bg-blue-600 border-blue-400 text-white shadow-lg' : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-blue-500 hover:text-blue-400'}`}>#{s.id}</button>
                ))}
             </div>
             {activeSample && <p className="mt-4 text-[10px] text-slate-500 italic leading-tight">{activeSample.desc}</p>}
          </div>

          <div className="pt-4 flex flex-col gap-3 mt-auto border-t border-slate-800">
            <button onClick={() => setIsPlaying(!isPlaying)} className={`w-full py-6 rounded-2xl font-black text-sm tracking-[0.25em] transition-all active:scale-[0.98] shadow-2xl flex items-center justify-center gap-4 ${isPlaying ? 'bg-red-500/10 text-red-500 border-2 border-red-500/50 hover:bg-red-500/20' : 'bg-blue-600 text-white border-2 border-blue-400 hover:bg-blue-500 hover:shadow-blue-500/50'}`}>
              {isPlaying ? <RotateCcw className="w-6 h-6 animate-spin-slow" /> : <Play className="w-6 h-6 fill-current" />}
              {isPlaying ? "STOP JETTING" : "START JETTING"}
            </button>
            <button onClick={handleReset} className="w-full py-3 bg-slate-800/30 hover:bg-slate-700/50 text-slate-500 hover:text-slate-300 rounded-xl text-[10px] font-bold tracking-widest transition-all uppercase border border-slate-700/30">Clear Trace</button>
          </div>
        </aside>

        <section className="flex-1 bg-slate-950 relative flex flex-col items-center justify-center overflow-hidden">
          <div className="absolute inset-0 opacity-40 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, #1e293b 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
          <div className="absolute inset-0 z-10">
            {particles.map(p => (
              <div key={p.id} className="absolute bg-blue-400 rounded-full" style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.size, height: p.size, transform: 'translate(-50%, -50%)', boxShadow: '0 0 10px rgba(96, 165, 250, 0.4)' }} />
            ))}
          </div>
          <div className="absolute left-[15%] top-1/2 -translate-y-1/2 -translate-x-1/2 z-20 flex flex-col items-center">
            <div className="w-16 h-16 rounded-full border-4 border-slate-700 bg-slate-900 shadow-2xl ring-8 ring-blue-500/10 flex items-center justify-center">
                <div className="w-2 h-2 bg-blue-500 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.8)]" />
            </div>
          </div>
        </section>

        <aside className="w-80 shrink-0 bg-slate-900 border-l border-slate-800 p-6 space-y-8 overflow-y-auto">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-6">EHD Analytics</h2>
          <div className="space-y-10">
            <div className="space-y-4">
              <p className="text-xs text-slate-400 font-medium tracking-tight">Est. Droplet Diameter</p>
              <div className="flex items-baseline gap-2"><p className="text-6xl font-mono font-bold text-slate-100 tabular-nums tracking-tighter">{predictedSize.toFixed(1)}</p><span className="text-xl font-mono text-blue-500/60 font-bold">µm</span></div>
            </div>
            <div className="h-[1px] bg-slate-800" />
            <div className="space-y-4">
               <p className="text-xs text-slate-400 font-medium tracking-tight">Ejection Profile</p>
               <div className="relative aspect-square w-full rounded-2xl border-2 border-slate-800 overflow-hidden shadow-2xl">
                  <canvas ref={microscopeCanvasRef} width={300} height={300} className="w-full h-full" />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/40 to-transparent pointer-events-none" />
               </div>
            </div>
          </div>
        </aside>
      </main>

      <footer className="h-10 shrink-0 bg-slate-900 border-t border-slate-800 px-6 flex items-center justify-between text-[10px] font-mono text-slate-500 tracking-wider">
        <div className="flex space-x-10">
          <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span> SYSTEM STATE: READY</span>
          <span className="text-slate-400 font-bold uppercase tracking-tight">Trace: <span className="text-blue-400 font-mono">{sampleProgress.toFixed(2)}mm</span></span>
        </div>
        <span className="text-slate-300 tracking-tighter uppercase font-bold pr-2">AgCite-90072-V3</span>
      </footer>
    </div>
  );
}
