// Reusable date-range control. useDateRange() owns the state and hands back the resolved
// { range } plus the { element } to drop into a page's toolbar — used by the reports and
// by the tracker pages (sales, expense, R&D, reimbursement).
//
// The preset dropdown (All time / This month / …) and the two date boxes are both always
// visible. Picking a preset fills the boxes with that range; typing in a box switches the
// dropdown to "Custom". One Reset button clears back to All time.
import { useState } from 'react';
import { presetRange, type DateRange, type Preset } from '../lib/dateRange';

type FixedPreset = Exclude<Preset, 'custom'>;
const PRESET_LABELS: Record<FixedPreset, string> = {
  all: 'All time', week: 'This week', month: 'This month', lastMonth: 'Last month',
  quarter: 'This quarter', year: 'This year', fy: 'This FY',
};
const DEFAULT_PRESETS: FixedPreset[] = ['all', 'week', 'month', 'quarter', 'year'];

export function useDateRange({
  initial = 'all',
  title = 'Filter by date',
  presets = DEFAULT_PRESETS,
}: { initial?: Preset; title?: string; presets?: FixedPreset[] } = {}) {
  const [preset, setPreset] = useState<Preset>(initial);
  const [custom, setCustom] = useState<DateRange>({ from: '', to: '' });
  const range = preset === 'custom' ? custom : presetRange(preset);

  // Editing a date box seeds from whatever range is currently showing, then marks it custom.
  const editBox = (part: 'from' | 'to', v: string) => {
    setCustom({ ...range, [part]: v });
    setPreset('custom');
  };
  const reset = () => { setPreset('all'); setCustom({ from: '', to: '' }); };
  const active = preset !== 'all';

  const element = (
    <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <select
        className="select"
        style={{ width: 132 }}
        value={preset}
        // Selecting "Custom" seeds the boxes with the current range so they aren't empty.
        onChange={(e) => { const v = e.target.value as Preset; if (v === 'custom') setCustom(range); setPreset(v); }}
        title={title}
      >
        {presets.map((p) => <option key={p} value={p}>{PRESET_LABELS[p]}</option>)}
        <option value="custom">Custom</option>
      </select>
      {/* The two date boxes only appear once "Custom" is chosen. */}
      {preset === 'custom' && (
        <>
          <input
            className="input" type="date" style={{ width: 148 }}
            value={range.from} max={range.to || undefined}
            onChange={(e) => editBox('from', e.target.value)} title="From date"
          />
          <span className="muted" style={{ fontSize: 12 }}>to</span>
          <input
            className="input" type="date" style={{ width: 148 }}
            value={range.to} min={range.from || undefined}
            onChange={(e) => editBox('to', e.target.value)} title="To date"
          />
        </>
      )}
      {active && <button className="btn btn-sm" onClick={reset} title="Clear the date filter">Reset</button>}
    </div>
  );

  return { range, element };
}


