import React, { useId, useRef, useState } from 'react';

interface OtpInputProps {
  label: string;
  value: string;
  onChange: (digits: string) => void;
  length?: number;
  helperText?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Id of an element (e.g. the step heading) that gives the field its context. */
  describedBy?: string;
}

/**
 * Six-box one-time-code field. One real <input> sits transparently over the boxes, so phone autofill
 * (autocomplete="one-time-code"), pasting the whole code, screen readers and Playwright's fill() all see a
 * single field; the boxes only render its digits and the caret position.
 */
export const OtpInput: React.FC<OtpInputProps> = ({ label, value, onChange, length = 6, helperText, autoFocus, disabled, describedBy }) => {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, length - 1);

  return (
    <div className="otp">
      <label htmlFor={id} className="sr-only">{label}</label>
      <div className="otp__boxes" onClick={() => ref.current?.focus()}>
        {Array.from({ length }, (_, i) => (
          <div
            key={i}
            aria-hidden="true"
            className={`otp__box${value[i] ? ' otp__box--filled' : ''}${focused && i === active ? ' otp__box--active' : ''}`}
          >
            {value[i] ?? ''}
          </div>
        ))}
        <input
          ref={ref}
          id={id}
          className="otp__input"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
          onFocus={(e) => {
            setFocused(true);
            // Keep the caret at the end so typing always fills the next box.
            const end = e.currentTarget.value.length;
            e.currentTarget.setSelectionRange(end, end);
          }}
          onBlur={() => setFocused(false)}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={length}
          autoFocus={autoFocus}
          // React does not render the `autofocus` attribute; AuthPage's step focus looks for this one.
          data-autofocus={autoFocus ? '' : undefined}
          disabled={disabled}
          aria-describedby={[helperText ? `${id}-help` : '', describedBy ?? ''].filter(Boolean).join(' ') || undefined}
          required
        />
      </div>
      {helperText && <p id={`${id}-help`} className="otp__help">{helperText}</p>}
    </div>
  );
};
