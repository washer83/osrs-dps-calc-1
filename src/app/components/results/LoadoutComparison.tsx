import React, {
  useCallback, useEffect, useMemo, useState,
} from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  TooltipProps,
  XAxis,
  YAxis,
} from 'recharts';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/state';
import Select from '@/app/components/generic/Select'; // Assuming path is correct
import { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { useTheme } from 'next-themes';
import equipmentStats from '@/public/img/Equipment Stats.png';
import SectionAccordion from '@/app/components/generic/SectionAccordion';
import LazyImage from '@/app/components/generic/LazyImage';
import { CompareResult, CompareXAxis, CompareYAxis } from '@/lib/Comparator';
import { CompareRequest, WorkerRequestType } from '@/worker/CalcWorkerTypes';
import { keys } from '@/utils';
import { ChartAnnotation } from '@/types/State';
import { useCalc } from '@/worker/CalcWorker';

// --- XAxisOptions (no change) ---
const XAxisOptions = [
  { label: 'Monster defence level', axisLabel: 'Level', value: CompareXAxis.MONSTER_DEF_INITIAL },
  { label: 'Monster magic level', axisLabel: 'Level', value: CompareXAxis.MONSTER_MAGIC },
  { label: 'Monster HP', axisLabel: 'Hitpoints', value: CompareXAxis.MONSTER_HP },
  { label: 'Player attack level', axisLabel: 'Level', value: CompareXAxis.PLAYER_ATTACK_LEVEL },
  { label: 'Player strength level', axisLabel: 'Level', value: CompareXAxis.PLAYER_STRENGTH_LEVEL },
  { label: 'Player defence level', axisLabel: 'Level', value: CompareXAxis.PLAYER_DEFENCE_LEVEL },
  { label: 'Player ranged level', axisLabel: 'Level', value: CompareXAxis.PLAYER_RANGED_LEVEL },
  { label: 'Player magic level', axisLabel: 'Level', value: CompareXAxis.PLAYER_MAGIC_LEVEL },
  { label: 'Player stat decay', axisLabel: 'Minutes after boost', value: CompareXAxis.STAT_DECAY_RESTORE },
];

// --- CustomTooltip component (no changes) ---
const CustomTooltip: React.FC<TooltipProps<ValueType, NameType>> = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white shadow rounded p-2 text-sm text-black flex items-center gap-2">
        <div>
          <p><strong>{label}</strong></p>
          {payload.map((p) => (
            <div key={p.name} className="flex justify-between w-40 gap-2">
              <div className="flex items-center gap-1 leading-3 overflow-hidden">
                <div><div className="w-3 h-3 inline-block border border-gray-400 rounded-lg" style={{ backgroundColor: p.color }} /></div>
                {p.name}
              </div>
              <span className="text-gray-400 font-bold">{p.value === 'NaN' ? '---' : `${p.value}`}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

const LoadoutComparison: React.FC = observer(() => {
  const calc = useCalc();
  const store = useStore();
  const monster = JSON.stringify(store.monster);
  const { showLoadoutComparison } = store.prefs;
  const loadouts = JSON.stringify(store.loadouts);

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const [compareResult, setCompareResult] = useState<CompareResult>();
  const [xAxisType, setXAxisType] = useState<{ label: string, axisLabel?: string, value: CompareXAxis } | null | undefined>(XAxisOptions[0]);
  const [yAxisType, setYAxisType] = useState<{ label: string, axisLabel?: string, value: CompareYAxis } | null | undefined>({ label: 'Player damage-per-second', axisLabel: 'DPS', value: CompareYAxis.PLAYER_DPS });

  const YAxisOptions = useMemo(() => {
    const opts = [
      { label: 'Player damage-per-second', axisLabel: 'DPS', value: CompareYAxis.PLAYER_DPS },
      { label: 'Player expected hit', axisLabel: 'Hit', value: CompareYAxis.PLAYER_EXPECTED_HIT },
      { label: 'Time-to-kill', axisLabel: 'Seconds', value: CompareYAxis.PLAYER_TTK },
      { label: 'Player max hit', axisLabel: 'Max hit', value: CompareYAxis.PLAYER_MAX_HIT },
      { label: 'Expected Defence Reduction', axisLabel: 'Def Reduction', value: CompareYAxis.MONSTER_EXPECTED_DEF_AFTER_SPEC },
    ];
    if (!store.isNonStandardMonster) {
      opts.push(
        { label: 'Player damage taken per sec', axisLabel: 'DPS', value: CompareYAxis.MONSTER_DPS },
        { label: 'Player damage taken per kill', axisLabel: 'Damage', value: CompareYAxis.DAMAGE_TAKEN },
      );
    }
    return opts;
  }, [store.isNonStandardMonster]);

  // --- useEffect hooks (no changes needed) ---
  useEffect(() => {
    if (!YAxisOptions.find((opt) => opt.value === yAxisType?.value)) { setYAxisType(YAxisOptions[0]); }
  }, [yAxisType, YAxisOptions]);

  useEffect(() => {
    if (!showLoadoutComparison || !xAxisType || !yAxisType || !calc.isReady()) { setCompareResult(undefined); return; }
    const req: CompareRequest = {
      type: WorkerRequestType.COMPARE,
      data: {
        loadouts: JSON.parse(loadouts),
        monster: JSON.parse(monster),
        axes: { x: xAxisType.value, y: yAxisType.value },
      },
    };
    calc.do(req).then((resp) => { setCompareResult(resp.payload); })
      .catch((e: unknown) => { console.error('[LoadoutComparison] Failed to compute compare results', e); });
  }, [showLoadoutComparison, loadouts, monster, xAxisType, yAxisType, calc]);

  const [tickCount, domainMax] = useMemo(() => {
    if (!compareResult?.domainMax) { return [1, 1]; }
    const highest = Math.ceil(compareResult.domainMax);
    if (yAxisType?.value === CompareYAxis.MONSTER_EXPECTED_DEF_AFTER_SPEC) {
      const numTicks = Math.min(10, Math.max(5, highest + 1)); return [numTicks, highest];
    }
    if (highest <= 0) return [1, 1]; const stepsize = 10 ** Math.floor(Math.log10(highest) - 1);
    if (stepsize <= 0) return [1, highest]; const ceilHighest = Math.ceil(1 / stepsize * highest) * stepsize - 1 / 1e9;
    const count = 1 + Math.ceil(1 / stepsize * highest); return [count, ceilHighest];
  }, [compareResult, yAxisType]);

  // --- generateChartLines (no changes needed) ---
  const generateChartLines = useCallback(() => {
    if (!compareResult?.entries.length) { return []; }
    const strokeColours = isDark ? ['cyan', 'yellow', 'lime', 'orange', 'pink'] : ['blue', 'chocolate', 'green', 'sienna', 'purple'];
    const lines: React.ReactNode[] = [];
    const firstEntryKeys = compareResult.entries.length > 0 ? keys(compareResult.entries[0]) : [];
    firstEntryKeys.forEach((k) => {
      if (k !== 'name') {
        const colour = strokeColours.shift() || 'red';
        lines.push(<Line key={k as string} type="monotone" dataKey={k as string} stroke={colour} name={k as string} dot={false} isAnimationActive={false} />);
        strokeColours.push(colour);
      }
    });
    return lines;
  }, [compareResult, isDark]);

  // --- generateAnnotations (no changes needed) ---
  const generateAnnotations = useCallback((): React.ReactNode[] => {
    if (!compareResult) { return []; }
    const toRecharts = (a: ChartAnnotation, x: boolean): React.ReactNode => (
      <ReferenceLine
        key={`${a.label}-${x ? 'x' : 'y'}-${a.value}`}
        label={{
          value: a.label, angle: (x ? 90 : 0), fontSize: 12, fill: isDark ? 'white' : 'black',
        }}
        x={x ? a.value : undefined}
        y={!x ? a.value : undefined}
        stroke="red"
        strokeDasharray="6 6"
      />
    );
    return [...compareResult.annotations.x.map((a) => toRecharts(a, true)), ...compareResult.annotations.y.map((a) => toRecharts(a, false))];
  }, [compareResult, isDark]);

  return (
    <SectionAccordion
      defaultIsOpen={showLoadoutComparison}
      onIsOpenChanged={(o) => store.updatePreferences({ showLoadoutComparison: o })}
      title={(
        <div className="flex items-center gap-2">
          {' '}
          <div className="w-6 flex justify-center"><LazyImage src={equipmentStats.src} /></div>
          {' '}
          <h3 className="font-serif font-bold">Loadout Comparison Graph</h3>
          {' '}
        </div>
)}
    >
      {compareResult ? (
        <div className="px-6 py-4">
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={compareResult.entries} margin={{ top: 40, right: 20 }}>
              <XAxis allowDecimals={false} dataKey="name" stroke="#777777" interval="preserveStartEnd" label={{ value: xAxisType?.axisLabel || 'Value', position: 'insideBottom', offset: -15 }} reversed={xAxisType?.value === CompareXAxis.MONSTER_DEF_INITIAL} type="number" domain={['dataMin', 'dataMax']} />
              <YAxis
                stroke="#777777"
                domain={[0, domainMax]}
                tickCount={tickCount}
                tickFormatter={(v: number) => `${parseFloat(v.toFixed(2))}`}
                interval="preserveStartEnd"
                label={{
                  value: yAxisType?.axisLabel || 'Value', position: 'insideLeft', angle: -90, style: { textAnchor: 'middle' },
                }}
              />
              <CartesianGrid stroke="gray" strokeDasharray="5 5" />
              <Tooltip content={(props) => <CustomTooltip {...props} />} />
              <Legend wrapperStyle={{ fontSize: '.9em', top: 0 }} />
              {generateChartLines()}
              {generateAnnotations()}
            </LineChart>
          </ResponsiveContainer>
          <div className="my-4 flex flex-wrap md:flex-nowrap gap-4 max-w-lg m-auto dark:text-white">
            {/* X Axis Selector */}
            <div className="basis-full md:basis-1/2">
              <h3 className="font-serif font-bold mb-2">X axis</h3>
              <Select
                id="loadout-comparison-x"
                items={XAxisOptions}
                value={xAxisType || undefined}
                // --- REMOVED getLabel ---
                onSelectedItemChange={(i) => {
                  setXAxisType(i);
                }}
              />
            </div>
            {/* Y Axis Selector */}
            <div className="basis-full md:basis-1/2">
              <h3 className="font-serif font-bold mb-2">Y axis</h3>
              <Select
                id="loadout-comparison-y"
                items={YAxisOptions}
                value={yAxisType || undefined}
                 // --- REMOVED getLabel ---
                onSelectedItemChange={(i) => {
                  setYAxisType(i);
                }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="px-6 py-4 text-center text-gray-500">
          {' '}
          {showLoadoutComparison ? 'Generating graph data...' : 'Comparison graph disabled.'}
          {' '}
        </div>
      )}
    </SectionAccordion>
  );
});

export default LoadoutComparison;
