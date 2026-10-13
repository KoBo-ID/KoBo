import React from 'react';
import { RoomOccupancyBoard } from '../owner/RoomOccupancyBoard';
import type { BoardRoom } from '../../../../backend/src/trpc/router';

const noop = () => {};

const room = (
  roomNumber: string,
  floor: number,
  status: BoardRoom['status'],
  priceMonthly: number,
  extra: Partial<BoardRoom> = {},
): BoardRoom => ({
  id: `demo-${roomNumber}`,
  roomNumber,
  floor,
  type: 'Standar',
  size: '3x4 m',
  bedType: 'Single',
  priceMonthly,
  status,
  tenancyId: status === 'vacant' ? null : `demo-t-${roomNumber}`,
  tenant: null,
  invoice: null,
  daysOverdue: 0,
  lastReceipt: null,
  ...extra,
});

const tenant = (name: string, campus: string) => ({ name, phone: null, campus });

// Static, made-up data. Dates are fixed so the preview never changes between renders.
const DEMO_ROOMS: BoardRoom[] = [
  room('101', 1, 'paid', 1_500_000, {
    tenant: tenant('Rina Putri', 'UI'),
    invoice: { id: 'demo-i-101', dueDate: '2026-11-05', amount: 1_500_000 },
    lastReceipt: { receiptNumber: 1, receiptNo: 'KWT-0001' },
  }),
  room('102', 1, 'due', 1_500_000, {
    tenant: tenant('Dimas Pratama', 'Binus'),
    invoice: { id: 'demo-i-102', dueDate: '2026-10-15', amount: 1_500_000 },
  }),
  room('103', 1, 'overdue', 1_600_000, {
    tenant: tenant('Alya Nugroho', 'UNJ'),
    invoice: { id: 'demo-i-103', dueDate: '2026-10-05', amount: 1_600_000 },
    daysOverdue: 8,
  }),
  room('104', 1, 'vacant', 1_600_000),
  room('201', 2, 'booking', 1_800_000, {
    tenant: tenant('Fajar Hidayat', 'Trisakti'),
    invoice: { id: 'demo-i-201', dueDate: '2026-10-20', amount: 1_800_000 },
  }),
  room('202', 2, 'paid', 1_800_000, {
    tenant: tenant('Sinta Dewi', 'UI'),
    invoice: { id: 'demo-i-202', dueDate: '2026-11-01', amount: 1_800_000 },
    lastReceipt: { receiptNumber: 2, receiptNo: 'KWT-0002' },
  }),
  room('203', 2, 'vacant', 1_800_000),
];

/** The real owner board with static demo rooms. Inert: it is a picture of the product, not a control. */
export const OwnerBoardPreview: React.FC = () => (
  <figure className="owner-preview">
    <figcaption className="owner-preview__caption">
      Contoh papan okupansi kamar: tujuh kamar di dua lantai dengan status lunas, jatuh tempo, menunggak, kosong, dan booking.
    </figcaption>
    <div className="owner-preview__window" aria-hidden="true" inert>
      <div className="owner-preview__scale">
        <RoomOccupancyBoard
          kosName="Kos Contoh"
          rooms={DEMO_ROOMS}
          onOpenWhatsApp={noop}
          onMarkPaid={noop}
          onEndTenancy={noop}
        />
      </div>
    </div>
  </figure>
);
