import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Calendar as CalendarIcon, BarChart2, Activity, Plus, Mic, Send, 
  ChevronRight, Home, CheckCircle, Clock, RefreshCw, 
  X, Edit3, Trash2, Zap, Play, Pause, RotateCcw,
  Paperclip, ArrowLeft, Settings as SettingsIcon,
  Moon, Sun, Bell, Database, Key, ShieldAlert,
  ChevronDown, ChevronUp, ChevronLeft, Users, MapPin, Trophy, Ticket,
  Menu, PanelLeftClose
} from 'lucide-react';
import FocusCompanionMock from '../common/FocusCompanionMock';


export default function FocusDetailView({ t, theme, task, onComplete, onBack, onFurtherBreakdown, onRegenerate, onFocusSessionComplete, onOpenRecovery }) {
  const initialMinutes = task?.estimatedMinutes || 25;
  const [selectedMinutes, setSelectedMinutes] = useState(initialMinutes);
  const [customMinutes, setCustomMinutes] = useState(String(initialMinutes));
  const [timeLeft, setTimeLeft] = useState(initialMinutes * 60);
  const [isActive, setIsActive] = useState(false);
  const [focusedSeconds, setFocusedSeconds] = useState(0);
  const [sessionStartedAt, setSessionStartedAt] = useState(null);

  useEffect(() => {
    const m = task?.estimatedMinutes || 25;
    setSelectedMinutes(m);
    setCustomMinutes(String(m));
    setTimeLeft(m * 60);
    setIsActive(false);
    setFocusedSeconds(0);
    setSessionStartedAt(null);
  }, [task?.id]);

  useEffect(() => {
    let interval = null;
    if (isActive && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft(prev => prev - 1);
        setFocusedSeconds(prev => prev + 1);
      }, 1000);
    } else if (timeLeft === 0) {
      setIsActive(false);
    }
    return () => clearInterval(interval);
  }, [isActive, timeLeft]);

  const updateMinutes = (m) => {
    const safeMinutes = Math.max(1, Math.min(180, Number(m) || 25));
    setSelectedMinutes(safeMinutes);
    setCustomMinutes(String(safeMinutes));
    setIsActive(false);
    setTimeLeft(safeMinutes * 60);
    setFocusedSeconds(0);
    setSessionStartedAt(null);
  };

  const applyCustomMinutes = () => {
    updateMinutes(customMinutes);
  };

  const toggleTimer = () => {
    if (!isActive && !sessionStartedAt) {
      setSessionStartedAt(new Date().toISOString());
    }
    setIsActive(!isActive);
  };
  const resetTimer = () => {
    setIsActive(false);
    setTimeLeft(selectedMinutes * 60);
    setFocusedSeconds(0);
    setSessionStartedAt(null);
  };
  const formatTime = (s) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const handleComplete = async () => {
    setIsActive(false);

    const elapsedSeconds = focusedSeconds > 0
      ? focusedSeconds
      : Math.max(0, selectedMinutes * 60 - timeLeft);
    const minutes = elapsedSeconds > 0 ? Math.max(1, Math.round(elapsedSeconds / 60)) : 0;

    if (minutes > 0) {
      await onFocusSessionComplete?.({
        task,
        minutes,
        startedAt: sessionStartedAt || new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });
    }

    onComplete?.(task);
  };

  return (
    <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full animate-fade-in relative pt-2">
      
      <button onClick={onBack} className={`flex items-center gap-2 font-semibold mb-8 w-fit transition-colors ${t.textMuted} hover:text-indigo-400`}>
        <ChevronLeft className="w-5 h-5" /> Back to list
      </button>

      <div className={`rounded-3xl p-8 md:p-14 shadow-2xl border flex flex-col items-center text-center relative overflow-hidden ${t.bgCard} ${t.border}`}>
        
        {/* Radar Ping Animation for Focus */}
        <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] aspect-square rounded-full border-[2px] border-indigo-500/10 pointer-events-none transition-transform duration-1000 ${isActive ? 'scale-110 animate-[ping_4s_cubic-bezier(0,0,0.2,1)_infinite]' : 'scale-100 opacity-0'}`} />

        <div className="relative z-10 w-full">
          <span className="inline-block px-4 py-1.5 bg-indigo-500/10 text-indigo-400 rounded-full text-xs font-bold tracking-widest uppercase mb-6 border border-indigo-500/20">Hyper Focus Mode</span>
          <h2 className={`text-2xl md:text-3xl font-bold mb-6 leading-tight ${t.textMain}`}>{task.title}</h2>
          
          <div className="max-w-xl mx-auto mb-8">
            <p className={`text-base leading-relaxed ${t.textMuted}`}>
              {task.desc || "Focus on this single step. Eliminate distractions. You can do this."}
            </p>
          </div>

          <div className="flex items-center justify-center gap-2 flex-wrap mb-4">
            {[5, 10, 15, 25, 45].map((m) => (
              <button
                key={m}
                onClick={() => updateMinutes(m)}
                disabled={isActive}
                className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${
                  selectedMinutes === m
                    ? 'bg-indigo-500 text-white border-indigo-500'
                    : `${t.secondaryBtn}`
                } ${isActive ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {m} min
              </button>
            ))}
          </div>

          <div className="flex items-center justify-center gap-2 mb-8">
            <input
              type="number"
              min="1"
              max="180"
              value={customMinutes}
              disabled={isActive}
              onChange={(e) => setCustomMinutes(e.target.value)}
              className={`w-28 px-4 py-3 rounded-xl border text-center text-base font-semibold outline-none ${t.bgInput} ${t.border} ${t.textMain} ${isActive ? 'opacity-50 cursor-not-allowed' : ''}`}
              placeholder="mins"
            />
            <button
              onClick={applyCustomMinutes}
              disabled={isActive}
              className={`px-4 py-3 rounded-xl font-bold transition-colors ${
                isActive
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-indigo-500 text-white hover:bg-indigo-400'
              }`}
            >
              Apply
            </button>
          </div>

          {/* Timer Display */}
          <div className={`text-7xl md:text-8xl font-black tracking-tighter mb-12 font-mono drop-shadow-lg ${t.textMain}`}>
            {formatTime(timeLeft)}
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-4 mb-10">
            <button onClick={resetTimer} className={`p-4 rounded-2xl transition-colors ${t.secondaryBtn}`} title="Reset Timer">
              <RotateCcw className="w-6 h-6" />
            </button>
            
            <button 
              onClick={toggleTimer}
              className={`flex items-center justify-center gap-3 px-10 py-5 rounded-2xl text-xl font-bold text-white transition-all active:scale-95 shadow-lg ${isActive ? 'bg-amber-500 shadow-amber-500/20 hover:bg-amber-400' : 'bg-indigo-600 shadow-indigo-600/30 hover:bg-indigo-500'}`}
            >
              {isActive ? <Pause className="w-6 h-6 fill-white" /> : <Play className="w-6 h-6 fill-white" />}
              {isActive ? 'Pause Focus' : 'Start Focus'}
            </button>
          </div>

          <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 items-center justify-center gap-4 mt-8 pt-8 border-t w-full ${t.border}`}>
            <button onClick={onFurtherBreakdown} className={`px-6 py-3 rounded-xl font-bold transition-colors w-full ${t.secondaryBtn}`}>
              Too hard? Breakdown further
            </button>
            <button onClick={onRegenerate} className="px-6 py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 font-bold hover:bg-amber-100 transition-colors flex items-center justify-center gap-2 w-full">
              <RefreshCw className="w-5 h-5" /> Regenerate
            </button>
            <button onClick={() => { setIsActive(false); onOpenRecovery?.(); }} className="px-6 py-3 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-500 font-bold hover:bg-violet-500/20 transition-colors flex items-center justify-center gap-2 w-full">
              <Clock className="w-5 h-5" /> My plan changed
            </button>
            <button onClick={handleComplete} className="px-6 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 font-bold hover:bg-emerald-500/20 transition-colors flex items-center justify-center gap-2 w-full">
              <CheckCircle className="w-5 h-5" /> Mark Completed
            </button>
          </div>

          <FocusCompanionMock
            isActive={isActive}
            taskTitle={task.title}
            onReturn={() => setIsActive(true)}
            onOpenRecovery={() => { setIsActive(false); onOpenRecovery?.(); }}
          />
        </div>
      </div>
    </div>
  );
}

// ==========================================
// UI & UTILITY COMPONENTS
// ==========================================
