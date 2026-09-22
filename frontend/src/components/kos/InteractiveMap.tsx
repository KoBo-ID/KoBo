import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Minus, Compass, GraduationCap, Navigation } from 'lucide-react';
import { Kos } from '../../types';
import { useAppStore } from '../../store/AppContext';

interface InteractiveMapProps {
  kosList: Kos[];
  onSelectKos?: (kos: Kos) => void;
  height?: string | number;
}

export const InteractiveMap: React.FC<InteractiveMapProps> = ({
  kosList,
  onSelectKos,
  height = '100%',
}) => {
  const navigate = useNavigate();
  const { hoveredKosId, setHoveredKosId, activeLocation } = useAppStore();
  const [zoomLevel, setZoomLevel] = useState(1);

  const activeAreaLabel = activeLocation ? activeLocation.label : 'Jakarta Barat';

  const formatAbbreviatedRupiah = (val: number) => {
    const juta = val / 1000000;
    return `${juta.toFixed(1).replace('.0', '')}jt`;
  };

  // Map pin relative coordinates mapping (simulated vector grid coordinates)
  // Normalized between 10% and 90%
  const getPinCoordinates = (index: number) => {
    const coords = [
      { top: '38%', left: '42%' }, // Kos 1 (Syahdan)
      { top: '28%', left: '60%' }, // Kos 2 (Anggrek)
      { top: '56%', left: '35%' }, // Kos 3 (Kijang)
      { top: '72%', left: '65%' }, // Kos 4 (UI Depok)
      { top: '48%', left: '78%' }, // Kos 5 (ITB)
    ];
    return coords[index % coords.length];
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height,
        minHeight: '400px',
        backgroundColor: '#e8ecef',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.04)',
      }}
    >
      {/* Stylized Vector Map Background (Simulated OpenStreetMap / Mapbox light theme) */}
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 800 600"
        preserveAspectRatio="none"
        style={{
          position: 'absolute',
          inset: 0,
          transform: `scale(${zoomLevel})`,
          transformOrigin: 'center center',
          transition: 'transform 0.3s var(--ease-out-spring)',
        }}
      >
        {/* Background land */}
        <rect width="800" height="600" fill="#F4F6F8" />

        {/* Green Parks / Campus Zones */}
        <path d="M 280,180 Q 340,150 400,210 T 360,300 T 260,260 Z" fill="#E2F2E9" opacity="0.8" />
        <path d="M 450,80 Q 520,70 580,120 T 540,220 T 420,160 Z" fill="#E2F2E9" opacity="0.8" />
        <path d="M 120,420 Q 200,390 280,450 T 220,560 T 100,500 Z" fill="#E2F2E9" opacity="0.8" />

        {/* Major Roads Grid */}
        <line x1="0" y1="240" x2="800" y2="240" stroke="#FFFFFF" strokeWidth="16" />
        <line x1="0" y1="240" x2="800" y2="240" stroke="#E2E8F0" strokeWidth="12" />

        <line x1="320" y1="0" x2="320" y2="600" stroke="#FFFFFF" strokeWidth="18" />
        <line x1="320" y1="0" x2="320" y2="600" stroke="#CBD5E1" strokeWidth="14" />

        <line x1="0" y1="460" x2="800" y2="380" stroke="#FFFFFF" strokeWidth="14" />
        <line x1="0" y1="460" x2="800" y2="380" stroke="#E2E8F0" strokeWidth="10" />

        <line x1="560" y1="0" x2="520" y2="600" stroke="#FFFFFF" strokeWidth="14" />
        <line x1="560" y1="0" x2="520" y2="600" stroke="#E2E8F0" strokeWidth="10" />

        {/* Secondary streets */}
        <path d="M 100,80 L 320,140 L 560,180 L 750,150" fill="none" stroke="#F1F5F9" strokeWidth="6" />
        <path d="M 200,300 L 450,330 L 680,290" fill="none" stroke="#F1F5F9" strokeWidth="6" />
        <path d="M 400,240 L 420,480" fill="none" stroke="#F1F5F9" strokeWidth="5" />
        <path d="M 180,160 L 220,380" fill="none" stroke="#F1F5F9" strokeWidth="5" />

        {/* Campus 500m & 1km Walking Radius Rings */}
        <circle cx="340" cy="240" r="130" fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeDasharray="6,6" opacity="0.35" />
        <circle cx="340" cy="240" r="230" fill="none" stroke="var(--primary)" strokeWidth="1" strokeDasharray="4,4" opacity="0.2" />

        {/* Walking radius text */}
        <text x="350" y="118" fill="var(--primary)" fontSize="11" fontWeight="600" opacity="0.7">Radius 500m (Jalan 6 mnt)</text>
        <text x="350" y="20" fill="var(--primary)" fontSize="11" fontWeight="600" opacity="0.6">Radius 1km (Jalan 12 mnt)</text>
      </svg>

      {/* Campus Anchor Point Icon */}
      <div
        style={{
          position: 'absolute',
          top: '40%',
          left: '42.5%',
          transform: 'translate(-50%, -50%)',
          zIndex: 3,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            backgroundColor: 'var(--text-main)',
            color: 'white',
            padding: '0.35rem 0.65rem',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.75rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '0.3rem',
            boxShadow: 'var(--shadow-md)',
            whiteSpace: 'nowrap',
          }}
        >
          <GraduationCap size={14} color="#FBBF24" />
          <span>{activeAreaLabel}</span>
        </div>
        <div
          style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            backgroundColor: 'var(--text-main)',
            border: '2px solid white',
            marginTop: '0.2rem',
            boxShadow: 'var(--shadow-sm)',
          }}
        />
      </div>

      {/* Interactive Price Pills for each Kos */}
      {kosList.map((kos, index) => {
        const coord = getPinCoordinates(index);
        const isHovered = hoveredKosId === kos.id;

        return (
          <div
            key={kos.id}
            onMouseEnter={() => setHoveredKosId(kos.id)}
            onMouseLeave={() => setHoveredKosId(null)}
            onClick={() => {
              if (onSelectKos) {
                onSelectKos(kos);
              } else {
                navigate(`/kos/${kos.id}`);
              }
            }}
            className="interactive-tap"
            style={{
              position: 'absolute',
              top: coord.top,
              left: coord.left,
              transform: isHovered
                ? 'translate(-50%, -100%) scale(1.15)'
                : 'translate(-50%, -100%) scale(1)',
              zIndex: isHovered ? 10 : 4,
              cursor: 'pointer',
              transition: 'transform var(--duration-fast) var(--ease-out-spring), z-index 0.1s',
            }}
          >
            {/* Price Pill */}
            <div
              style={{
                backgroundColor: isHovered ? 'var(--accent)' : 'var(--bg-surface)',
                color: isHovered ? 'white' : 'var(--text-main)',
                border: `1.5px solid ${isHovered ? 'var(--accent)' : 'var(--border-strong)'}`,
                padding: '0.35rem 0.65rem',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 800,
                fontSize: '0.8125rem',
                boxShadow: isHovered ? 'var(--shadow-hover)' : 'var(--shadow-md)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
                whiteSpace: 'nowrap',
              }}
            >
              {/* Discount dot indicator */}
              {kos.studentDiscountAmount > 0 && (
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: isHovered ? 'white' : 'var(--primary)',
                  }}
                />
              )}
              <span>Rp {formatAbbreviatedRupiah(kos.priceMonthlyStart)}</span>
            </div>

            {/* Pin pointer triangle */}
            <div
              style={{
                width: 0,
                height: 0,
                borderLeft: '5px solid transparent',
                borderRight: '5px solid transparent',
                borderTop: `6px solid ${isHovered ? 'var(--accent)' : 'var(--bg-surface)'}`,
                margin: '0 auto',
              }}
            />
          </div>
        );
      })}

      {/* Floating Map Controls (Zoom In, Zoom Out, Recenter) */}
      <div
        style={{
          position: 'absolute',
          top: '1rem',
          right: '1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.4rem',
          zIndex: 5,
        }}
      >
        <button
          onClick={() => setZoomLevel((z) => Math.min(z + 0.2, 1.8))}
          className="interactive-tap"
          style={{
            width: '36px',
            height: '36px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-main)',
          }}
          aria-label="Perbesar peta"
        >
          <Plus size={18} />
        </button>
        <button
          onClick={() => setZoomLevel((z) => Math.max(z - 0.2, 0.8))}
          className="interactive-tap"
          style={{
            width: '36px',
            height: '36px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-main)',
          }}
          aria-label="Perkecil peta"
        >
          <Minus size={18} />
        </button>
        <button
          onClick={() => setZoomLevel(1)}
          className="interactive-tap"
          style={{
            width: '36px',
            height: '36px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-main)',
          }}
          aria-label="Pusatkan peta"
        >
          <Compass size={18} />
        </button>
      </div>

      {/* Bottom info badge */}
      <div
        style={{
          position: 'absolute',
          bottom: '0.85rem',
          left: '0.85rem',
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          backdropFilter: 'blur(6px)',
          padding: '0.35rem 0.75rem',
          borderRadius: 'var(--radius-badge)',
          border: '1px solid var(--border-subtle)',
          fontSize: '0.72rem',
          fontWeight: 600,
          color: 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          zIndex: 5,
        }}
      >
        <Navigation size={12} color="var(--primary)" />
        <span>Peta Interaktif KoBo · Jarak Riil Pejalan Kaki</span>
      </div>
    </div>
  );
};
