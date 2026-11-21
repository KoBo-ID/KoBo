import React from 'react';
import { Check } from 'lucide-react';

export interface StepperProps {
  steps: { id: string; label: string }[];
  /** 0-based index of the step being shown. */
  current: number;
  /** 0-based index of the furthest step reached; only steps up to it can be clicked. */
  furthest: number;
  onStepClick?: (index: number) => void;
}

/**
 * Numbered progress for a multi-step form. Done steps show a check, upcoming steps are named for screen readers, so
 * colour is never the only signal. Below 40rem the labels fold into one "Langkah n dari N" live line (styles: auth-page.css).
 */
export const Stepper: React.FC<StepperProps> = ({ steps, current, furthest, onStepClick }) => {
  const shown = Math.min(Math.max(current, 0), steps.length - 1);
  return (
    <nav className="stepper" aria-label="Langkah pendaftaran">
      <ol className="stepper__list">
        {steps.map((s, i) => {
          const done = i < current;
          const here = i === current;
          const reachable = !!onStepClick && i <= furthest && !here;
          const state = done ? 'done' : here ? 'current' : 'todo';
          const orb = (
            <>
              <span className="stepper__orb" aria-hidden="true">
                {done ? <Check size={14} strokeWidth={3} /> : i + 1}
              </span>
              <span className="stepper__label">{s.label}</span>
              <span className="sr-only">{done ? ' selesai' : here ? '' : ' belum'}</span>
            </>
          );
          return (
            <li key={s.id} className="stepper__item" data-state={state} aria-current={here ? 'step' : undefined}>
              {reachable ? (
                <button type="button" className="stepper__btn" onClick={() => onStepClick(i)}>
                  {orb}
                </button>
              ) : (
                <span className="stepper__btn stepper__btn--static">{orb}</span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="stepper__live" aria-live="polite">
        Langkah {shown + 1} dari {steps.length}: {steps[shown]?.label}
      </p>
    </nav>
  );
};
