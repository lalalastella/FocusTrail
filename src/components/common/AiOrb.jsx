import React from 'react';
import { ThinkingOrb } from 'thinking-orbs';

export default function AiOrb({ state = 'idle', theme = 'light', label = 'AI assistant' }) {
  const orbState = state === 'idle' ? 'breathing' : state;

  return <ThinkingOrb className="fc-thinking-orb" state={orbState} size={64} theme={theme} aria-label={label} />;
}
