import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check, ChevronDown, ChevronUp, Clock3, Sparkles, Volume2, X } from 'lucide-react';

const COPY = {
  idle: {
    eyebrow: '目标导航伙伴',
    title: '回旋风筝在等你出发',
    body: '开始专注后，我会替你牵着这条目标线。',
  },
  focused: {
    eyebrow: '专注中 · 航线稳定',
    title: '风很轻，继续眼前这一步',
    body: '我会安静地待在这里，不打扰你的节奏。',
  },
  drifting: {
    eyebrow: '疑似偏离 · 00:48',
    title: '好像被风带远了一点',
    body: '当前活动可能与目标无关。先确认一下，不急着责怪自己。',
  },
  alert: {
    eyebrow: '持续偏离 · 03:12',
    title: '我还替你牵着目标线',
    body: '原计划可能受到影响。现在回来，或让我帮你缩短路线。',
  },
  returned: {
    eyebrow: '已回到目标',
    title: '回来了，我们只做眼前这一步',
    body: '这次回正已记入你的 FocusTrail。',
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
        alt="FELR 回旋风筝人格 IP"
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
            <span className="fc-prototype-pill"><Sparkles size={12} /> FocusTrail 桌宠 · Prototype</span>
            <button type="button" className="fc-bubble-close" onClick={() => setIsExpanded(false)} aria-label="收起消息"><X size={15} /></button>
          </div>

          <div className="fc-companion-copy">
            <span className="fc-companion-eyebrow">{copy.eyebrow}</span>
            <h3>{copy.title}</h3>
            <p>{copy.body}</p>
            <div className="fc-current-thread">
              <span>目标线</span>
              <strong>{taskTitle || '当前专注任务'}</strong>
            </div>
          </div>

          {state === 'drifting' && (
            <div className="fc-companion-actions">
              <button type="button" className="fc-action-primary" onClick={returnToTask}><ArrowRight size={16} /> 回到任务</button>
              <button type="button" className="fc-action-secondary" onClick={markRelevant}><Check size={15} /> 这是任务需要</button>
              <button type="button" className="fc-action-ghost" onClick={remindLater}><Clock3 size={15} /> 稍后提醒</button>
            </div>
          )}

          {state === 'alert' && (
            <div className="fc-companion-actions fc-companion-actions-alert">
              <button type="button" className="fc-action-primary" onClick={returnToTask}><ArrowRight size={16} /> 立即回去</button>
              <button type="button" className="fc-action-recovery" onClick={openRecovery}><Sparkles size={15} /> 生成恢复方案</button>
              <button type="button" className="fc-action-ghost" onClick={markRelevant}><X size={15} /> 暂停提醒</button>
            </div>
          )}
        </div>
      )}

      <div className="fc-pet-dock">
        <div className="fc-pet-drag-region" title="按住并拖动桌宠">
          <TurningKite state={state} />
          <span className="fc-drag-hint">拖动我</span>
        </div>
        <div className="fc-pet-controls">
          <button type="button" title="播放桌宠提示音" aria-label="播放桌宠提示音"><Volume2 size={18} /></button>
          <button type="button" onClick={() => setIsExpanded((value) => !value)} title={showMessage ? '收起消息' : '展开消息'} aria-label={showMessage ? '收起消息' : '展开消息'}>
            {showMessage ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
          </button>
        </div>
        <button type="button" className="fc-demo-trigger" onClick={simulateDistraction} disabled={!isActive || isIntervening}>
          <Sparkles size={13} /> 模拟分心
        </button>
      </div>
    </section>
  );

  return createPortal(companion, document.body);
}
