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

import CollapsibleText from '../common/CollapsibleText';
import FocusDetailView from './FocusDetailView';

const isRulesSource = (source = '') => String(source).toLowerCase().includes('rules');

export default function ViewCE({ t, theme, rootTask, path, onBreakdown, onRegenerate, onOpenNode, showToast, onTaskComplete, onFocusSessionComplete, onOpenRecovery }) {
  const [focusingSubtask, setFocusingSubtask] = useState(null);

  let currentContext = rootTask;
  let contextList = rootTask.children || [];

  const normalizedPath =
    path.length > 0 && path[0] === rootTask.id ? path.slice(1) : path;

  for (let i = 0; i < normalizedPath.length; i++) {
    const node = contextList.find(n => n.id === normalizedPath[i]);
    if (node) {
      currentContext = node;
      contextList = node.children || [];
    }
  }

  if (focusingSubtask) {
    const activeSubtask = contextList.find(n => n.id === focusingSubtask) || currentContext;
    return (
      <FocusDetailView
        t={t}
        theme={theme}
        task={activeSubtask}
        onBack={() => setFocusingSubtask(null)}
        onFocusSessionComplete={onFocusSessionComplete}
        onComplete={(completedTask) => {
          onTaskComplete?.(completedTask || activeSubtask);
          showToast('Subtask Completed!', 'success');
          setFocusingSubtask(null);
        }}
        onFurtherBreakdown={() => { setFocusingSubtask(null); onBreakdown(activeSubtask.id); }}
        onRegenerate={() => { setFocusingSubtask(null); onRegenerate(activeSubtask.id); }}
        onOpenRecovery={() => onOpenRecovery?.(activeSubtask.id)}
      />
    );
  }

  return (
    <div className="flex-1 max-w-4xl mx-auto w-full animate-fade-in pb-10">
      <div className={`mb-8 mt-2 flex justify-between items-end border-b pb-6 ${t.border}`}>
        <div>
          <h2 className={`text-2xl font-bold mb-2 ${t.textMain}`}>{currentContext.title}</h2>
          <p className={`text-sm ${t.textMuted}`}>Select a step to focus on, regenerate just one step, or break one step into 3 smaller steps.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => onOpenRecovery?.(currentContext.id)} className="px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 border border-amber-400/30 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 transition-colors">
            <Clock className="w-4 h-4" /> My plan changed
          </button>
          <button onClick={() => onRegenerate(currentContext.id)} className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors ${t.secondaryBtn}`}>
            <RefreshCw className="w-4 h-4" /> Regenerate
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {contextList.map((sub, index) => (
          <div key={sub.id} className={`rounded-2xl p-5 border shadow-sm hover:shadow-md transition-all group flex flex-col md:flex-row md:items-start justify-between gap-6 animate-slide-up ${t.bgCard} ${t.border} hover:${t.borderFocus}`} style={{ animationDelay: `${index * 0.05}s` }}>
            <div className="flex items-start gap-4 flex-1 pt-1">
              <div className="w-8 h-8 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold text-sm shrink-0 mt-1 border border-indigo-500/20">
                {index + 1}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className={`text-lg font-bold transition-colors cursor-pointer hover:text-indigo-400 ${t.textMain}`} onClick={() => setFocusingSubtask(sub.id)}>
                    {sub.title}
                  </h3>
                  {sub.aiSource && (
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${
                        isRulesSource(sub.aiSource)
                          ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                          : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                      }`}
                    >
                      {isRulesSource(sub.aiSource) ? 'Rules' : 'Gemma'}
                    </span>
                  )}
                </div>
                <div className="mt-2">
                  <CollapsibleText t={t} text={sub.desc} defaultExpanded={false} />
                </div>

                {sub.children && sub.children.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onOpenNode(sub.id)}
                    className={`flex items-center gap-2 mt-4 text-xs font-semibold px-3 py-1.5 rounded-md w-fit transition-colors ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10' : 'bg-slate-100 hover:bg-slate-200'} ${t.textMuted}`}
                  >
                    <ChevronRight className="w-3 h-3" />
                    Open {sub.children.length} deeper sub-steps
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 self-end md:self-center bg-transparent p-1 rounded-xl">
              <button
                onClick={() => onRegenerate(sub.id)}
                className={`p-2.5 rounded-lg transition-colors tooltip-trigger ${t.textMuted} hover:text-indigo-400 hover:bg-indigo-500/10`}
                title="Regenerate only this subtask"
              >
                <RefreshCw className="w-4 h-4" />
              </button>

              <button
                onClick={() => (sub.children && sub.children.length > 0 ? onOpenNode(sub.id) : onBreakdown(sub.id))}
                className={`px-4 py-2 text-sm font-bold rounded-lg transition-colors whitespace-nowrap ${t.secondaryBtn}`}
              >
                {sub.children && sub.children.length > 0 ? 'Open' : 'Breakdown'}
              </button>

              <button
                onClick={() => setFocusingSubtask(sub.id)}
                className={`px-5 py-2 text-sm font-bold rounded-lg transition-all whitespace-nowrap flex items-center gap-2 ${t.primaryBtn}`}
              >
                <Play className="w-4 h-4 fill-current" /> Focus
              </button>
            </div>
          </div>
        ))}

        {contextList.length === 0 && (
          <div className={`text-center py-16 border-2 border-dashed rounded-3xl ${t.border} ${t.bgCard}`}>
            <p className={`mb-6 text-lg ${t.textMuted}`}>No sub-steps yet. Need help starting?</p>
            <button onClick={() => onBreakdown(currentContext.id)} className={`px-8 py-3 font-bold rounded-xl transition-colors ${t.primaryBtn}`}>
              Auto-Breakdown
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// STATE D: Focus Detail View
