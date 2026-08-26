import React, { useState } from 'react';
import { Calendar as CalendarIcon, Plus, ChevronRight, ChevronLeft, CheckCircle, Trash2, History, Edit3, X } from 'lucide-react';

export default function CalendarPanel({ t, tasks, historyRecords = [], onSelectTask, onCreateTask, onUpdateTaskDate, activeTaskId, onDeleteTask, onToggleTask, onDeleteHistoryRecord }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('');
  const [selectedDay, setSelectedDay] = useState(null);
  const [editingDueId, setEditingDueId] = useState(null);

  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  const prevMonth = () => {
    setSelectedDay(null);
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };

  const nextMonth = () => {
    setSelectedDay(null);
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const makeDateStr = (day) => `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const isToday = (day) => viewYear === today.getFullYear() && viewMonth === today.getMonth() && day === today.getDate();

  const tasksWithDueDate = tasks.filter(tk => tk.date);
  const getTaskForDay = (day) => tasksWithDueDate.filter(tk => tk.date === makeDateStr(day));

  const handleDayClick = (day) => {
    if (selectedDay === day) {
      setNewDate(makeDateStr(day));
      setShowAdd(true);
    } else {
      setSelectedDay(day);
      setShowAdd(false);
    }
  };

  const displayTasks = selectedDay
    ? tasksWithDueDate.filter(tk => tk.date === makeDateStr(selectedDay))
    : tasksWithDueDate.filter(tk => {
        const [y, m] = tk.date.split('-').map(Number);
        return y === viewYear && m === viewMonth + 1;
      });
  const sortedTasks = [...displayTasks].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const saveNewTask = () => {
    if (!newTitle.trim()) return;
    onCreateTask(newTitle.trim(), newDate || undefined);
    setNewTitle('');
    setNewDate('');
    setShowAdd(false);
  };

  const handleImportICS = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text !== 'string') return;
      const events = text.split('BEGIN:VEVENT');
      let imported = 0;
      events.forEach(block => {
        const summaryMatch = block.match(/SUMMARY[^:]*:(.*)/);
        const dtMatch = block.match(/DTSTART[^:]*:(\d{4})(\d{2})(\d{2})/);
        if (summaryMatch && dtMatch) {
          const title = summaryMatch[1].trim();
          const date = `${dtMatch[1]}-${dtMatch[2]}-${dtMatch[3]}`;
          onCreateTask(title, date);
          imported++;
        }
      });
      alert(imported > 0 ? `Imported ${imported} event${imported > 1 ? 's' : ''} successfully!` : 'No events found in this file.');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const renderDueBadge = (tk) => {
    if (!tk.date) return <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${t.border} ${t.textMuted}`}>No DDL</span>;
    const diff = Math.ceil((new Date(tk.date) - new Date(todayStr)) / 86400000);
    if (diff < 0) return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/10 text-rose-500 font-bold">Overdue</span>;
    if (diff === 0) return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500 font-bold">Today</span>;
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 font-bold">Due in {diff}d</span>;
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <h4 className={`font-bold text-lg ${t.textMain}`}>{monthNames[viewMonth]} {viewYear}</h4>
        <div className="flex gap-2">
          <button onClick={prevMonth} className={`p-1.5 rounded-lg border ${t.border} ${t.textMuted} hover:text-indigo-400 hover:border-indigo-500/50`}><ChevronLeft className="w-4 h-4"/></button>
          <button onClick={nextMonth} className={`p-1.5 rounded-lg border ${t.border} ${t.textMuted} hover:text-indigo-400 hover:border-indigo-500/50`}><ChevronRight className="w-4 h-4"/></button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5 text-center">
        {['S','M','T','W','T','F','S'].map((d,i) => <div key={i} className={`text-xs font-bold pb-1 ${t.textMuted}`}>{d}</div>)}
        {Array.from({ length: firstDayOfWeek }).map((_, i) => <div key={`pad-${i}`} className="aspect-square" />)}
        {days.map(d => {
          const dayTasks = getTaskForDay(d);
          const hasPending = dayTasks.some(tk => tk.status === 'pending');
          const hasDone = dayTasks.some(tk => tk.status === 'done');
          const isSelected = selectedDay === d;
          let dayClass = `${t.bgCard} ${t.border} ${t.textMain}`;
          if (isSelected) dayClass = 'bg-indigo-500 border-indigo-500 text-white font-bold';
          else if (isToday(d)) dayClass = 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400 font-bold';
          return (
            <div key={d} onClick={() => handleDayClick(d)} className={`aspect-square flex flex-col items-center justify-center rounded-lg border text-sm relative transition-all cursor-pointer hover:border-indigo-500/50 ${dayClass}`}>
              {d}
              <div className="flex gap-0.5 mt-0.5 absolute bottom-0.5">
                {hasDone && <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white/70' : 'bg-emerald-500'}`} />}
                {hasPending && <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white/70' : 'bg-rose-500'}`} />}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2">
        <button onClick={() => { setShowAdd(!showAdd); if (!showAdd) setNewDate(selectedDay ? makeDateStr(selectedDay) : ''); }} className={`flex-1 py-2.5 rounded-xl font-bold border border-dashed flex items-center justify-center gap-2 transition-colors text-sm ${t.border} ${t.textMuted} hover:border-indigo-500/50 hover:text-indigo-400`}>
          <Plus className="w-4 h-4" /> Add Task
        </button>
        <label className={`py-2.5 px-3 rounded-xl font-bold border border-dashed flex items-center justify-center gap-2 transition-colors text-sm cursor-pointer ${t.border} ${t.textMuted} hover:border-indigo-500/50 hover:text-indigo-400`}>
          <CalendarIcon className="w-4 h-4" /> Import .ics
          <input type="file" accept=".ics" onChange={handleImportICS} className="hidden" />
        </label>
      </div>

      {showAdd && (
        <div className={`p-4 rounded-xl border ${t.bgCard} ${t.border} animate-slide-up space-y-3`}>
          <input type="text" placeholder="Task title..." value={newTitle} onChange={e=>setNewTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveNewTask(); }} className={`w-full bg-transparent border-b pb-2 focus:outline-none focus:border-indigo-500 text-sm ${t.border} ${t.textMain}`} />
          <div className="flex items-center gap-2">
            <label className={`text-xs ${t.textMuted}`}>DDL optional:</label>
            <input type="date" value={newDate} onChange={e=>setNewDate(e.target.value)} className={`flex-1 bg-transparent border-b pb-1 focus:outline-none focus:border-indigo-500 text-sm ${t.border} ${t.textMain}`} />
            {newDate && <button onClick={() => setNewDate('')} className={`p-1 ${t.textMuted}`}><X className="w-3 h-3" /></button>}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowAdd(false)} className={`px-3 py-1.5 text-xs font-bold rounded-lg ${t.secondaryBtn}`}>Cancel</button>
            <button onClick={saveNewTask} className={`px-3 py-1.5 text-xs font-bold rounded-lg ${t.primaryBtn}`}>Save</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h4 className={`font-bold text-xs uppercase tracking-wider mb-2 ${t.textMuted}`}>
          {selectedDay ? `Tasks on ${monthNames[viewMonth]} ${selectedDay}` : (sortedTasks.length > 0 ? `Tasks in ${monthNames[viewMonth]}` : `No dated tasks in ${monthNames[viewMonth]}`)}
        </h4>
        {sortedTasks.length === 0 && selectedDay && <p className={`text-sm ${t.textMuted}`}>No tasks on this day. Click "+ Add Task" to create one.</p>}
        {sortedTasks.map(tk => (
          <TaskRow key={tk.id} tk={tk} t={t} activeTaskId={activeTaskId} onSelectTask={onSelectTask} onToggleTask={onToggleTask} onDeleteTask={onDeleteTask} editingDueId={editingDueId} setEditingDueId={setEditingDueId} onUpdateTaskDate={onUpdateTaskDate} renderDueBadge={renderDueBadge} />
        ))}
      </div>

      {historyRecords.length > 0 && (
        <div className="space-y-2 pt-3 border-t border-dashed border-slate-500/20">
          <h4 className={`font-bold text-xs uppercase tracking-wider flex items-center gap-2 ${t.textMuted}`}><History className="w-3.5 h-3.5" /> Historical Records</h4>
          <p className={`text-[11px] ${t.textMuted}`}>Tasks that have already been broken down. Calendar links here instead of forcing a new breakdown.</p>
          {historyRecords.map(record => {
            const task = tasks.find(tk => tk.id === record.id) || record;
            return (
              <TaskRow
                key={record.id}
                tk={task}
                t={t}
                activeTaskId={activeTaskId}
                onSelectTask={onSelectTask}
                onToggleTask={null}
                onDeleteTask={(id) => {
                  if (window.confirm('Remove this item from Historical Records? The original task and its breakdown will be kept.')) {
                    onDeleteHistoryRecord?.(id);
                  }
                }}
                editingDueId={editingDueId}
                setEditingDueId={setEditingDueId}
                onUpdateTaskDate={onUpdateTaskDate}
                renderDueBadge={renderDueBadge}
                compact
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function TaskRow({ tk, t, activeTaskId, onSelectTask, onToggleTask, onDeleteTask, editingDueId, setEditingDueId, onUpdateTaskDate, renderDueBadge, compact = false }) {
  return (
    <div className={`p-3 rounded-xl border flex gap-3 cursor-pointer transition-all ${activeTaskId === tk.id ? 'border-indigo-500 bg-indigo-500/5' : `${t.bgCard} ${t.border} hover:border-indigo-500/30`}`}>
      {onToggleTask && (
        <button onClick={(e) => { e.stopPropagation(); onToggleTask(tk.id); }} className={`w-4 h-4 mt-1 rounded-full shrink-0 border-2 flex items-center justify-center transition-colors ${tk.status === 'done' ? 'bg-emerald-500 border-emerald-500' : 'border-rose-400 hover:border-emerald-400'}`}>
          {tk.status === 'done' && <CheckCircle className="w-3 h-3 text-white" />}
        </button>
      )}
      <div className="flex-1 min-w-0" onClick={() => onSelectTask(tk.id)}>
        <h4 className={`font-bold text-sm ${tk.status === 'done' ? 'line-through opacity-50' : ''} ${activeTaskId === tk.id ? 'text-indigo-400' : t.textMain}`}>{tk.title}</h4>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {editingDueId === tk.id ? (
            <input type="date" value={tk.date || ''} onClick={e => e.stopPropagation()} onChange={e => onUpdateTaskDate?.(tk.id, e.target.value)} className={`bg-transparent border-b text-[10px] ${t.border} ${t.textMain}`} />
          ) : (
            <p className={`text-[10px] ${t.textMuted}`}>{tk.date || 'No DDL'}</p>
          )}
          {renderDueBadge(tk)}
          {compact && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 font-bold">Breakdown saved</span>}
        </div>
      </div>
      <button onClick={(e) => { e.stopPropagation(); setEditingDueId(editingDueId === tk.id ? null : tk.id); }} className={`p-1 rounded-lg transition-colors ${t.textMuted} hover:text-indigo-400`} title="Edit DDL">
        <Edit3 className="w-3.5 h-3.5" />
      </button>
      {onDeleteTask && (
        <button onClick={(e) => { e.stopPropagation(); onDeleteTask(tk.id); }} className={`p-1 rounded-lg transition-colors ${t.textMuted} hover:text-rose-400`}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
