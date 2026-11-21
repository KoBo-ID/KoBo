import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../ui/Modal';
import { OwnerDataStep } from '../auth/OwnerDataStep';

/** "Daftarkan diri sebagai pemilik" from the profile page: the owner data step in a dialog, then the owner workspace (documents follow there). */
export const BecomeOwnerModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const navigate = useNavigate();
  return (
    <Modal isOpen onClose={onClose} title="Daftar sebagai pemilik kos" subtitle="Gratis. Akun Anda tetap sama untuk mencari kos dan mengelola kos." maxWidth="sm">
      <OwnerDataStep
        onDone={() => {
          onClose();
          navigate('/owner/dashboard');
        }}
      />
    </Modal>
  );
};
