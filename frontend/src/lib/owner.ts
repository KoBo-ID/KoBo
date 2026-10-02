import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTRPC } from './trpc';
import { useAuthActions } from './session';
import { messageForError } from './errors';

/** "Daftarkan diri sebagai pemilik": owner.becomeOwner, then refresh the session and open the workspace. */
export function useBecomeOwner() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { refreshSession } = useAuthActions();
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation(trpc.owner.becomeOwner.mutationOptions());

  const becomeOwner = async () => {
    setError(null);
    try {
      await mutation.mutateAsync();
      await refreshSession();
      navigate('/owner/dashboard');
    } catch (err) {
      setError(messageForError(err));
    }
  };

  return { becomeOwner, isPending: mutation.isPending, error };
}
