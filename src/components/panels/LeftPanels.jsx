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

import CalendarPanel from './CalendarPanel';
import StatsPanel from './StatsPanel';
import MonitorPanel from './MonitorPanel';
import SettingsPanel from './SettingsPanel';

export default function LeftPanels({ t, theme, activePanel, close, stats, tasks, settings, setSettings, onSelectTask, onCreateTask, onUpdateTaskDate, onDeleteTask, onToggleTask, onDeleteHistoryRecord, historyRecords, activeTaskId, showToast }) {
  const [panelWidth, setPanelWidth] = useState(360);

  if (!activePanel) return null;

  return (
    <>
      {/* Mobile backdrop only */}
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-sm md:hidden z-30"
        onClick={close}
      />

      <div className={`border-r shadow-lg flex flex-col shrink-0 z-30 relative ${t.bgPanel} ${t.border}`} style={{ width: panelWidth }}>
        {/* 右侧拖拽条 */}
        <div
          className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize z-40 group -mr-1"
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = panelWidth;
            const onMove = (ev) => {
              const diff = ev.clientX - startX;
              setPanelWidth(Math.max(260, Math.min(600, startW + diff)));
            };
            const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          }}
        >
          <div className={`w-0.5 h-full mx-auto transition-colors group-hover:bg-indigo-500 ${t.border}`}></div>
        </div>

        <div className={`p-6 flex items-center justify-between border-b ${t.border}`}>
          <h3 className={`font-bold text-lg capitalize ${t.textMain}`}>{activePanel}</h3>
          <button onClick={close} className={`p-2 rounded-xl transition-colors ${t.textMuted} ${theme === 'dark' ? 'hover:bg-white/5' : 'hover:bg-slate-100'}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
          {activePanel === 'calendar' && <CalendarPanel t={t} tasks={tasks} historyRecords={historyRecords} onSelectTask={onSelectTask} onCreateTask={onCreateTask} onUpdateTaskDate={onUpdateTaskDate} activeTaskId={activeTaskId} onDeleteTask={onDeleteTask} onToggleTask={onToggleTask} onDeleteHistoryRecord={onDeleteHistoryRecord} />}
          {activePanel === 'stats' && <StatsPanel t={t} theme={theme} stats={stats} />}
          {activePanel === 'monitor' && <MonitorPanel t={t} theme={theme} enabled={settings.monitorEnabled} onToggle={(v) => setSettings({ ...settings, monitorEnabled: v })} showToast={showToast} activeTask={tasks.find((tk) => tk.id === activeTaskId) || null} />}
          {activePanel === 'settings' && <SettingsPanel t={t} settings={settings} setSettings={setSettings} showToast={showToast} />}
        </div>
      </div>
    </>
  );
}

// Quick Notes content (used both in the right sidebar and the mobile drawer)
