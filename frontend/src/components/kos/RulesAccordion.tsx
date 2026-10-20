import React, { useState } from 'react';
import { ChevronDown, AlertCircle } from 'lucide-react';
import { HouseRule } from '../../types';
import { formatRupiah } from '../../lib/format';

interface RulesAccordionProps {
  rules: HouseRule[];
}

export const RulesAccordion: React.FC<RulesAccordionProps> = ({ rules }) => {
  // Collapsed by default: every group title and its fine stay visible in one short list, and the section
  // never grows past a normal window. A group opens on demand.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const allOpen = rules.length > 0 && expanded.size === rules.length;

  return (
    <section
      className="kos-rules"
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)',
        padding: '1.5rem',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div className="section-head">
        <div>
          <h3 className="section-title">Tata tertib dan denda</h3>
          <p className="section-sub">Aturan dan denda tertulis sebelum Anda mengajukan sewa.</p>
        </div>
        {rules.length > 1 && (
          <button
            type="button"
            className="kos-rules__all"
            onClick={() => setExpanded(allOpen ? new Set() : new Set(rules.map((rule) => rule.id)))}
          >
            {allOpen ? 'Tutup semua' : 'Buka semua'}
          </button>
        )}
      </div>

      <div className="kos-rules__groups">
        {rules.map((rule) => {
          const isExpanded = expanded.has(rule.id);
          const panelId = `kos-rule-panel-${rule.id}`;

          return (
            <section key={rule.id} className="kos-rules__group">
              <h4 className="kos-rules__heading">
                <button
                  type="button"
                  onClick={() => setExpanded((current) => {
                    const next = new Set(current);
                    if (isExpanded) next.delete(rule.id); else next.add(rule.id);
                    return next;
                  })}
                  className="kos-rules__toggle"
                  aria-expanded={isExpanded}
                  aria-controls={panelId}
                >
                  <span className="kos-rules__label">
                    <span className="kos-rules__title">{rule.categoryTitle}</span>
                    <span className="kos-rules__count">{rule.rules.length} aturan</span>
                  </span>
                  <span className="kos-rules__aside">
                    {rule.penaltyAmount != null && <span className="kos-rules__fine">Denda {formatRupiah(rule.penaltyAmount)}</span>}
                    <ChevronDown
                      size={18}
                      color="var(--text-muted)"
                      aria-hidden="true"
                      style={{
                        transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform var(--duration-fast) var(--ease-out-spring)',
                      }}
                    />
                  </span>
                </button>
              </h4>

              <div id={panelId} hidden={!isExpanded} className="kos-rules__panel">
                <ul>
                  {rule.rules.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
                {rule.penaltyClause && (
                  <div className="kos-rules__clause">
                    <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '0.1rem' }} aria-hidden="true" />
                    <span>{rule.penaltyClause}</span>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
};
