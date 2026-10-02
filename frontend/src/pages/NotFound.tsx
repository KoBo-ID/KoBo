import React from 'react';
import { NotFoundState } from '../components/ui/QueryState';

export const NotFound: React.FC = () => (
  <NotFoundState
    title="Halaman tidak ditemukan"
    text="Alamat yang Anda buka tidak ada atau sudah dipindahkan."
    linkTo="/"
    linkLabel="Kembali ke Beranda"
  />
);
