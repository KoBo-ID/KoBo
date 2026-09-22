import React, { useState } from 'react';
import { ShieldAlert, ChevronDown, Clock, Zap, BookOpen, AlertCircle, Coins } from 'lucide-react';
import { HouseRule } from '../../types';

interface RulesAccordionProps {
  rules: HouseRule[];
}

export const RulesAccordion: React.FC<RulesAccordionProps> = ({ rules }) => {
  const [expandedTier, setExpandedTier] = useState<number | null>(1);

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(val);
  };

  const getTierIcon = (tier: number) => {
    switch (tier) {
      case 1:
        return <Clock size={18} color="var(--primary)" />;
      case 2:
        return <Zap size={18} color="#D97706" />;
      case 3:
        return <BookOpen size={18} color="#2563EB" />;
      case 4:
        return <AlertCircle size={18} color="var(--status-overdue)" />;
      default:
        return <ShieldAlert size={18} color="var(--primary)" />;
    }
  };

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)',
        padding: '1.5rem',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ShieldAlert size={22} color="var(--status-due)" />
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>
              Tata Tertib & Denda Transparan
            </h3>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            Aturan disepakati di awal untuk menghindari sengketa antara penyewa dan pengelola kos.
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            backgroundColor: 'var(--status-due-bg)',
            color: 'var(--status-due)',
            padding: '0.35rem 0.75rem',
            borderRadius: 'var(--radius-badge)',
            fontSize: '0.75rem',
            fontWeight: 700,
          }}
        >
          <Coins size={14} />
          <span>Klausul Denda Riil & Pasti</span>
        </div>
      </div>

      {/* Accordion Tiers */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {rules.map((rule) => {
          const isExpanded = expandedTier === rule.tier;

          return (
            <div
              key={rule.id}
              style={{
                border: `1.5px solid ${isExpanded ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                backgroundColor: isExpanded ? 'var(--bg-page)' : 'var(--bg-surface)',
                transition: 'all var(--duration-fast) var(--ease-out-spring)',
              }}
            >
              {/* Accordion Header */}
              <button
                onClick={() => setExpandedTier(isExpanded ? null : rule.tier)}
                className="interactive-tap"
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '1rem 1.25rem',
                  backgroundColor: 'transparent',
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--bg-surface)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: 'var(--shadow-xs)',
                      flexShrink: 0,
                    }}
                  >
                    {getTierIcon(rule.tier)}
                  </div>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
                    {rule.categoryTitle}
                  </h4>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  {rule.penaltyAmount && (
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        color: 'var(--status-overdue)',
                        backgroundColor: 'var(--status-overdue-bg)',
                        border: '1px solid var(--status-overdue-border)',
                        padding: '0.2rem 0.55rem',
                        borderRadius: 'var(--radius-badge)',
                      }}
                    >
                      Denda {formatRupiah(rule.penaltyAmount)}
                    </span>
                  )}
                  <ChevronDown
                    size={18}
                    color="var(--text-muted)"
                    style={{
                      transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform var(--duration-fast) var(--ease-out-spring)',
                    }}
                  />
                </div>
              </button>

              {/* Accordion Body */}
              {isExpanded && (
                <div
                  style={{
                    padding: '0 1.25rem 1.25rem 1.25rem',
                    borderTop: '1px solid var(--border-subtle)',
                    paddingTop: '1rem',
                  }}
                  className="animate-slide-up"
                >
                  <ul style={{ paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: rule.penaltyClause ? '1rem' : 0 }}>
                    {rule.rules.map((item, idx) => (
                      <li key={idx} style={{ fontSize: '0.875rem', color: 'var(--text-main)', lineHeight: 1.5 }}>
                        {item}
                      </li>
                    ))}
                  </ul>

                  {/* Penalty Clause Alert Box */}
                  {rule.penaltyClause && (
                    <div
                      style={{
                        backgroundColor: 'var(--status-overdue-bg)',
                        border: '1px solid var(--status-overdue-border)',
                        padding: '0.75rem 1rem',
                        borderRadius: 'var(--radius-sm)',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '0.65rem',
                        fontSize: '0.8125rem',
                        color: 'var(--status-overdue)',
                        fontWeight: 600,
                      }}
                    >
                      <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                      <span>{rule.penaltyClause}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
