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

import ChatInput from '../common/ChatInput';

export default function ViewA({ t, theme, value, onValueChange, file, onFileSelect, onFileClear, onSubmit, isSubmitting, submissionPreview, onCancelSubmission, webDemoMode }) {
  if (isSubmitting && submissionPreview) {
    return (
      <div className="flex-1 min-w-0 flex flex-col max-w-3xl mx-auto w-full animate-fade-in py-8 md:py-14">
        <div className="flex items-center gap-3 mb-10">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${theme === 'dark' ? 'bg-[#1c202a] border-white/10' : 'bg-white border-slate-200 shadow-sm'}`}>
            <img src="/logo.svg" alt="FocusTrail" className="w-7 h-7 object-contain" />
          </div>
          <div>
            <div className={`font-bold ${t.textMain}`}>FocusTrail</div>
            <div className={`text-xs ${t.textMuted}`}>Building your execution path</div>
          </div>
        </div>

        <div className="flex-1 space-y-6">
          <div className="flex justify-end animate-slide-up">
            <div className="max-w-[82%] rounded-3xl rounded-tr-md bg-indigo-600 text-white px-5 py-4 shadow-lg shadow-indigo-500/10">
              {submissionPreview.text && <p className="text-base leading-relaxed">{submissionPreview.text}</p>}
              {submissionPreview.fileName && (
                <div className="mt-3 rounded-xl bg-white/10 border border-white/15 px-3 py-2 text-sm font-semibold flex items-center gap-2">
                  <Paperclip className="w-4 h-4" /> {submissionPreview.fileName}
                </div>
              )}
              <div className="mt-3 flex items-center justify-end gap-3 text-[11px] text-indigo-100">
                <span>Sent</span>
                <button type="button" onClick={onCancelSubmission} className="inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/20 px-2 py-1 font-bold transition-colors">
                  <Edit3 className="w-3 h-3" /> Edit
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3 animate-slide-up" style={{ animationDelay: '100ms' }}>
            <div className={`w-9 h-9 rounded-xl shrink-0 flex items-center justify-center border ${theme === 'dark' ? 'bg-[#1c202a] border-white/10' : 'bg-white border-slate-200'}`}>
              <img src="/logo.svg" alt="" className="w-6 h-6 object-contain" />
            </div>
            <div className={`max-w-[82%] rounded-3xl rounded-tl-md border px-5 py-4 ${t.bgCard} ${t.border}`}>
              <div className={`font-semibold ${t.textMain}`}>Turning this into a focused 3-step plan…</div>
              <p className={`text-sm mt-1 ${t.textMuted}`}>Reviewing the goal, scope, and best place to start.</p>
              <div className="flex gap-1.5 mt-4" aria-label="FocusTrail is generating">
                {[0, 1, 2].map((index) => (
                  <span key={index} className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" style={{ animationDelay: `${index * 180}ms` }} />
                ))}
              </div>
              <button type="button" onClick={onCancelSubmission} className={`mt-4 inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${t.secondaryBtn}`}>
                <Pause className="w-3.5 h-3.5" /> Stop generating
              </button>
            </div>
          </div>
        </div>

        <div className={`mt-10 rounded-full border px-5 py-4 flex items-center justify-between opacity-70 ${t.bgInput} ${t.border}`}>
          <span className={`text-sm ${t.textMuted}`}>Your task was sent. FocusTrail is working on it.</span>
          <span className="w-5 h-5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col items-center justify-center max-w-3xl mx-auto w-full animate-fade-in">
      <div className="w-full min-w-0 text-center mb-12">
        {webDemoMode && (
          <div className="inline-flex items-center gap-2 mb-5 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1.5 text-xs font-bold text-indigo-500">
            Web Demo · Cloud AI with browser fallback
          </div>
        )}
        <div className={`w-16 h-16 rounded-2xl mx-auto mb-6 flex items-center justify-center border ${theme === 'dark' ? 'bg-[#1c202a] border-white/10 shadow-[0_0_30px_rgba(99,102,241,0.1)]' : 'bg-white border-slate-200 shadow-xl shadow-indigo-100'}`}>
           <img src="/logo.svg" alt="FocusTrail" className="w-10 h-10 object-contain" />
        </div>
        <h1 className={`text-3xl md:text-4xl font-bold tracking-tight mb-4 ${t.textMain}`}>What are we crushing today?</h1>
        <p className={`text-lg ${t.textMuted}`}>Type a task, upload Word/PDF, or add a screenshot or handwritten photo.</p>
      </div>

      <div className="w-full mt-4">
        <ChatInput
          t={t}
          theme={theme}
          value={value}
          onChange={onValueChange}
          file={file}
          onFileSelect={onFileSelect}
          onFileClear={onFileClear}
          onSubmit={onSubmit}
          isSubmitting={isSubmitting}
          placeholder="e.g. Write a 5-page history essay by Friday..."
        />
      </div>

      <div className="flex flex-wrap justify-center gap-3 mt-10">
         <SuggestionBadge t={t} text="Study for Math Midterm" onClick={() => onSubmit('Study for Math Midterm')} />
         <SuggestionBadge t={t} text="Clean my room" onClick={() => onSubmit('Clean my room')} />
         <SuggestionBadge t={t} text="Read 2 chapters" onClick={() => onSubmit('Read 2 chapters')} />
      </div>
    </div>
  );
}

function SuggestionBadge({ t, text, onClick }) {
  return (
    <button onClick={onClick} className={`px-4 py-2 border rounded-full text-sm transition-all shadow-sm ${t.bgCard} ${t.border} ${t.textMuted} hover:border-indigo-500/50 hover:text-indigo-400`}>
      {text}
    </button>
  );
}

// STATE B: Active Task Overview
