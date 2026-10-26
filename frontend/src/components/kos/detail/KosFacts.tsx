import React from 'react';
import { Users, BedDouble, Zap, Footprints, GraduationCap } from 'lucide-react';
import type { Kos } from '../../../types';

const GENDER_LABEL = { campur: 'Kos campur', putra: 'Kos putra', putri: 'Kos putri' } as const;

/** The spec row under the title: facts every renter checks first, all taken from the kos record. */
export const KosFacts: React.FC<{ kos: Kos }> = ({ kos }) => {
  const full = kos.totalRooms > 0 && kos.availableRooms === 0;
  const { campusName, distanceMeters, walkMinutes } = kos.campusProximity;
  return (
    <ul className="detail-facts" aria-label="Ringkasan kos">
      <li><Users size={15} aria-hidden="true" />{GENDER_LABEL[kos.gender]}</li>
      {kos.totalRooms > 0 && (
        <li className={full ? undefined : 'is-strong'}>
          <BedDouble size={15} aria-hidden="true" />
          {full ? 'Semua kamar terisi' : `${kos.availableRooms} dari ${kos.totalRooms} kamar tersedia`}
        </li>
      )}
      <li><Zap size={15} aria-hidden="true" />{kos.electricityType === 'included' ? 'Listrik termasuk sewa' : 'Listrik token, bayar sendiri'}</li>
      {campusName && (
        <li><Footprints size={15} aria-hidden="true" />{distanceMeters} m ke {campusName} · {walkMinutes} mnt jalan</li>
      )}
      {kos.studentDiscountLabel && (
        <li><GraduationCap size={15} aria-hidden="true" />{kos.studentDiscountLabel}</li>
      )}
    </ul>
  );
};
