import React from 'react';
import { NotFoundState } from '../components/ui/QueryState';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export const NotFound: React.FC = () => {
  useDocumentTitle('Halaman tidak ditemukan');
  return (
    <NotFoundState
      title="Halaman tidak ditemukan"
      text="Alamat yang Anda buka tidak ada atau sudah dipindahkan."
      linkTo="/"
      linkLabel="Kembali ke Beranda"
    />
  );
};
