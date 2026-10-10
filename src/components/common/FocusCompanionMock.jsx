import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check, ChevronDown, ChevronUp, Clock3, Sparkles, Volume2, X } from 'lucide-react';

const COPY = {
  idle: {
    eyebrow: 'Goal navigation companion',
    title: 'Turning Kite is ready when you are',
    body: 'Start a focus session, and I\'ll help you stay connected to your goal.',
  },
  focused: {
    eyebrow: 'Focused · On course',
    title: 'The wind is calm—keep going',
    body: 'I\'ll stay quietly by your side without interrupting your flow.',
  },
  drifting: {
    eyebrow: 'Possible distraction · 00:48',
    title: 'Looks like the wind carried you off course',
    body: 'Your current activity may not support your goal. Let\'s check—no judgment.',
  },
  alert: {
    eyebrow: 'Ongoing distraction · 03:12',
    title: 'I\'m still holding your goal line',
    body: 'Your plan may be slipping. Return now, or let me help you find a shorter route.',
  },
  returned: {
    eyebrow: 'Back on track',
    title: 'You\'re back—just take the next step',
    body: 'This recovery has been added to your FocusTrail.',
  },
};

function TurningKite({ state }) {
  return (
    <div className={`fc-kite-stage fc-kite-${state}`} aria-hidden="true">
      <div className="fc-kite-wind fc-kite-wind-one" />
      <div className="fc-kite-wind fc-kite-wind-two" />
      <img
        className="fc-kite-art"
        src="/personas/felr-turning-kite-transparent-v2.png"
        alt="FELR Turning Kite companion"
        draggable="false"
        onDragStart={(event) => event.preventDefault()}
      />
      <span className="fc-kite-orbit" />
    </div>
  );
}

export default function FocusCompanionMock({ isActive, taskTitle, onReturn, onOpenRecovery }) {
  const [overrideState, setOverrideState] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [position, setPosition] = useState(() => {
    try {
      const saved = localStorage.getItem('fc_turning_kite_position');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const escalationRef = useRef(null);
  const dragRef = useRef(null);
  const state = overrideState || (isActive ? 'focused' : 'idle');

  useEffect(() => () => clearTimeout(escalationRef.current), []);

  const simulateDistraction = () => {
    clearTimeout(escalationRef.current);
    setOverrideState('drifting');
    setIsExpanded(true);
    escalationRef.current = setTimeout(() => setOverrideState('alert'), 4200);
  };

  const returnToTask = () => {
    clearTimeout(escalationRef.current);
    setOverrideState('returned');
    onReturn?.();
    setTimeout(() => setOverrideState(null), 2600);
  };

  const markRelevant = () => {
    clearTimeout(escalationRef.current);
    setOverrideState(null);
  };

  const remindLater = () => {
    clearTimeout(escalationRef.current);
    setOverrideState(null);
  };

  const openRecovery = () => {
    clearTimeout(escalationRef.current);
    onOpenRecovery?.();
    setOverrideState(null);
  };

  const copy = COPY[state];
  const isIntervening = state === 'drifting' || state === 'alert';
  const showMessage = isExpanded || isIntervening || state === 'returned';
  const isOnLeft = position && position.x < window.innerWidth / 2;

  const handlePointerDown = (event) => {
    if (!event.target.closest('.fc-pet-drag-region')) return;
    event.preventDefault();
    const host = event.currentTarget;
    const rect = host.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    host.setPointerCapture(event.pointerId);
    host.classList.add('fc-companion-dragging');
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const margin = 8;
    const x = Math.min(window.innerWidth - drag.width - margin, Math.max(margin, event.clientX - drag.offsetX));
    const y = Math.min(window.innerHeight - drag.height - margin, Math.max(margin, event.clientY - drag.offsetY));
    setPosition({ x, y });
  };

  const handlePointerUp = (event) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.classList.remove('fc-companion-dragging');
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (position) localStorage.setItem('fc_turning_kite_position', JSON.stringify(position));
  };

  const companion = (
    <section
      className={`fc-companion ${isIntervening ? 'fc-companion-intervening' : ''} ${isOnLeft ? 'fc-companion-left' : ''}`}
      style={position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      aria-live="polite"
    >
      {showMessage && (
        <div className="fc-companion-bubble">
          <div className="fc-companion-topline">
            <span className="fc-prototype-pill"><Sparkles size={12} /> FocusTrail Companion · Prototype</span>
            <button type="button" className="fc-bubble-close" onClick={() => setIsExpanded(false)} aria-label="Collapse message"><X size={15} /></button>
          </div>

          <div className="fc-companion-copy">
            <span className="fc-companion-eyebrow">{copy.eyebrow}</span>
            <h3>{copy.title}</h3>
            <p>{copy.body}</p>
            <div className="fc-current-thread">
              <span>Goal line</span>
              <strong>{taskTitle || 'Current focus task'}</strong>
            </div>
          </div>

          {state === 'drifting' && (
            <div className="fc-companion-actions">
              <button type="button" className="fc-action-primary" onClick={returnToTask}><ArrowRight size={16} /> Return to task</button>
              <button type="button" className="fc-action-secondary" onClick={markRelevant}><Check size={15} /> This is task-related</button>
              <button type="button" className="fc-action-ghost" onClick={remindLater}><Clock3 size={15} /> Remind me later</button>
            </div>
          )}

          {state === 'alert' && (
            <div className="fc-companion-actions fc-companion-actions-alert">
              <button type="button" className="fc-action-primary" onClick={returnToTask}><ArrowRight size={16} /> Return now</button>
              <button type="button" className="fc-action-recovery" onClick={openRecovery}><Sparkles size={15} /> Create recovery plan</button>
              <button type="button" className="fc-action-ghost" onClick={markRelevant}><X size={15} /> Pause reminders</button>
            </div>
          )}
        </div>
      )}

      <div className="fc-pet-dock">
        <div className="fc-pet-drag-region" title="Hold and drag the companion">
          <TurningKite state={state} />
          <span className="fc-drag-hint">Drag me</span>
        </div>
        <div className="fc-pet-controls">
          <button type="button" title="Play companion sound" aria-label="Play companion sound"><Volume2 size={18} /></button>
          <button type="button" onClick={() => setIsExpanded((value) => !value)} title={showMessage ? 'Collapse message' : 'Expand message'} aria-label={showMessage ? 'Collapse message' : 'Expand message'}>
            {showMessage ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
          </button>
        </div>
        <button type="button" className="fc-demo-trigger" onClick={simulateDistraction} disabled={!isActive || isIntervening}>
          <Sparkles size={13} /> Simulate distraction
        </button>
      </div>
    </section>
  );

  return createPortal(companion, document.body);
}
