import React, { useState } from 'react';
import { User } from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { AuthForm, AUTH_TITLES, type AuthView } from '../components/auth/AuthForm';
import { takeGoogleReturnError } from '../lib/session';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** The in-context sign-in dialog (gated actions). The flow itself lives in components/auth/AuthForm, shared with /masuk. */
export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const [view, setView] = useState<AuthView>('login');
  const [initialError] = useState(takeGoogleReturnError);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <User size={20} color="var(--primary)" />
          <span>{AUTH_TITLES[view]}</span>
        </div>
      }
      maxWidth="sm"
    >
      <AuthForm variant="modal" onDone={onClose} onViewChange={setView} initialError={initialError} />
    </Modal>
  );
};
