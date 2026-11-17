import React from 'react';
import { Info } from 'lucide-react';
import { Popover } from './Popover';

interface InfoTipProps {
  /** The field the tip explains; becomes the button's accessible name ("Info: Potongan diskon mahasiswa"). */
  label: string;
  children: React.ReactNode;
}

/**
 * The (i) next to a field label. Opens on tap, click or Enter, closes with Escape or an outside press, and works without
 * hover, so it is not a touch dead end. Keep the text to one or two sentences; anything needed to finish the form belongs
 * in the field's visible hint instead.
 */
export const InfoTip: React.FC<InfoTipProps> = ({ label, children }) => (
  <Popover
    role="dialog"
    align="left"
    label={`Info: ${label}`}
    panelClassName="kobo-infotip"
    trigger={(p) => (
      <button {...p} type="button" className="kobo-infotip__btn" aria-label={`Info: ${label}`}>
        <Info size={15} aria-hidden="true" />
      </button>
    )}
  >
    {() => <p className="kobo-infotip__text">{children}</p>}
  </Popover>
);
