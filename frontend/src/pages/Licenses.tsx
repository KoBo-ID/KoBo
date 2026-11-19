import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { InfoPage, InfoSection, InfoList } from '../components/ui/InfoPage';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useTRPC } from '../lib/trpc';

const link = { color: 'var(--primary)', fontWeight: 600 } as const;

export const Licenses: React.FC = () => {
  useDocumentTitle('Lisensi & Sumber Data');
  const trpc = useTRPC();
  const { data, isPending, isError } = useQuery(trpc.catalog.licenses.queryOptions());

  return (
    <InfoPage title="Lisensi & Sumber Data" intro="Data peta dan tempat di KoBo berasal dari sumber terbuka berikut.">
      {isPending && <p>Memuat…</p>}
      {isError && <p>Gagal memuat daftar sumber data.</p>}
      {data && (
        <>
          <InfoSection heading="Sumber data">
            <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {data.sources.map((source) => (
                <li key={source.id}>
                  <strong>{source.name}</strong>
                  <div>{source.licence}</div>
                  <div>{source.attribution}</div>
                  <div>{source.use}</div>
                  <a href={source.href} target="_blank" rel="noopener noreferrer" style={link}>Lihat lisensi</a>
                </li>
              ))}
            </ul>
          </InfoSection>
          <InfoSection heading="Catatan">
            <InfoList items={[...data.notes]} />
          </InfoSection>
        </>
      )}
    </InfoPage>
  );
};

export default Licenses;
