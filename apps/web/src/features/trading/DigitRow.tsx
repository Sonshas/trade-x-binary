import { useMemo } from 'react'
import { cn } from '@/lib/cn'
import { scanDigits } from '@/domain/digit-scanner'
import { digitsFromTicks } from '@/domain/digit-stats'
import { contractDigitWins } from '@/domain/outcome/digit-graph'
import type { TradeResultAnimationState } from '@/features/trading/trade-result-animation'
import { useAccountMode } from '@/hooks/useAccountMode'
import { useTicketChartSelection } from '@/hooks/useTicketChartSelection'
import { winRatePercentForMode } from '@/lib/trade-settings'
import { demoWinRatePercent } from '@/lib/simulated-sync'
import type { Tick } from '@/types'

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const
const SAMPLE_WINDOW = 100
/** One grid column: 10 columns and 9 × 0.25rem gaps. */
const COLUMN_WIDTH = 'calc((100% - 2.25rem) / 10)'
const COLUMN_STEP = 'calc(100% + 0.25rem)'

function cursorTone(status: TradeResultAnimationState['status'] | 'idle') {
  if (status === 'lost') return { ring: 'border-put shadow-[0_0_12px_rgba(244,63,94,0.7)]', line: 'bg-put' }
  if (status === 'won') return { ring: 'border-call shadow-[0_0_12px_rgba(16,185,129,0.7)]', line: 'bg-call' }
  if (status === 'refunded') return { ring: 'border-mist', line: 'bg-mist' }
  return { ring: 'border-signal shadow-[0_0_10px_rgba(59,130,246,0.65)]', line: 'bg-signal' }
}

export function DigitRow({
  ticks,
  symbol,
  animation,
}: {
  ticks: Tick[]
  symbol: string
  animation?: TradeResultAnimationState
}) {
  const ticket = useTicketChartSelection()
  const { kind } = useAccountMode()
  const winRatePercent =
    kind === 'demo' ? demoWinRatePercent(winRatePercentForMode('demo')) : winRatePercentForMode('real')
  const anim = animation && animation.status !== 'idle' && animation.symbol === symbol ? animation : null
  const digits = useMemo(() => digitsFromTicks(ticks), [ticks])
  const scanBarrier = ticket.contractType === 'OVER_UNDER' ? ticket.barrier : 5
  const scan = useMemo(
    () =>
      scanDigits(digits, SAMPLE_WINDOW, scanBarrier, {
        contractOption: ticket.contractOption,
        selectedDigit: ticket.selectedDigit,
        barrier: ticket.barrier,
        winRatePercent,
      }),
    [digits, scanBarrier, ticket.contractOption, ticket.selectedDigit, ticket.barrier, winRatePercent],
  )
  const lastDigit = digits.length > 0 ? digits[digits.length - 1]! : null
  const counts = useMemo(() => {
    const map = new Map(scan.ranked.map((item) => [item.digit, item.count]))
    return DIGITS.map((digit) => map.get(digit) ?? 0)
  }, [scan])
  const uniform = scan.hottest.length === 10
  /** Single moving cursor: live last digit, or trade animation digit while a trade is active. */
  const cursorDigit = anim?.cursorDigit ?? lastDigit

  return (
    <section
      aria-label="Digit statistics"
      className="px-2.5 py-2"
      data-testid="digit-sample"
      data-sample={scan.sampleSize}
      data-window={SAMPLE_WINDOW}
      data-symbol={symbol}
      data-contract-type={ticket.contractType}
      data-contract-option={ticket.contractOption}
      data-barrier={ticket.contractType === 'OVER_UNDER' ? ticket.barrier : ''}
      data-digit={ticket.contractType === 'MATCH_DIFFER' ? ticket.selectedDigit : ''}
      data-win-rate={winRatePercent}
      data-first-epoch={ticks[Math.max(0, ticks.length - SAMPLE_WINDOW)]?.epoch ?? ''}
      data-last-epoch={ticks[ticks.length - 1]?.epoch ?? ''}
    >
      <div className="relative">
        <div className="relative grid grid-cols-10 gap-1" data-testid="digit-distribution">
          {DIGITS.map((digit) => {
            const count = counts[digit] ?? 0
            const hot = scan.sampleSize > 0 && !uniform && scan.hottest.includes(digit)
            const cold = scan.sampleSize > 0 && !uniform && scan.coldest.includes(digit)
            const isCurrent = cursorDigit === digit
            const wins = contractDigitWins(digit, ticket, winRatePercent)
            const share = scan.sampleSize > 0 ? (count / scan.sampleSize) * 100 : 0
            return (
              <div
                key={digit}
                data-testid={`digit-card-${digit}`}
                data-count={count}
                data-current={isCurrent ? 'true' : 'false'}
                data-hot={hot ? 'true' : 'false'}
                data-cold={cold ? 'true' : 'false'}
                data-wins={wins ? 'true' : 'false'}
                aria-label={`Digit ${digit}: ${wins ? 'wins' : 'loses'} at ${winRatePercent}% admin win rate, ${count} of ${scan.sampleSize} ticks${isCurrent ? ', latest digit' : ''}`}
                className="flex flex-col items-center"
              >
                <span
                  className={cn(
                    'relative z-[1] flex h-9 w-9 items-center justify-center rounded-full border-2 border-line bg-ink/80 font-display text-sm font-semibold sm:h-10 sm:w-10',
                    isCurrent ? 'text-signal' : 'text-paper',
                  )}
                >
                  {digit}
                </span>
                <span className="relative z-[1] mt-0.5 font-mono text-[10px] font-semibold tabular-nums text-mist">
                  {share.toFixed(1)}%
                </span>
              </div>
            )
          })}
        </div>
        {cursorDigit != null ? (
          <DigitCursor
            digit={cursorDigit}
            status={anim?.status ?? 'idle'}
            tradeId={anim?.tradeId ?? null}
          />
        ) : null}
      </div>
    </section>
  )
}

/**
 * The one blue circle and its pointer, moved together as a single element.
 * translateX steps whole columns (column width + the 0.25rem grid gap).
 */
function DigitCursor({
  digit,
  status,
  tradeId,
}: {
  digit: number
  status: TradeResultAnimationState['status']
  tradeId: string | null
}) {
  const tone = cursorTone(status)
  return (
    <div
      aria-hidden="true"
      data-testid="digit-cursor"
      data-digit={digit}
      data-status={status}
      data-trade-id={tradeId ?? ''}
      className="pointer-events-none absolute inset-y-0 left-0 z-10 will-change-transform motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out"
      style={{ width: COLUMN_WIDTH, transform: `translateX(calc(${digit} * ${COLUMN_STEP}))` }}
    >
      <span
        data-testid="digit-cursor-circle"
        data-digit={digit}
        className={cn(
          'absolute left-1/2 top-0 h-9 w-9 -translate-x-1/2 rounded-full border-[3px] sm:h-10 sm:w-10',
          tone.ring,
        )}
      />
      <span className={cn('absolute bottom-0 left-1/2 top-9 w-0.5 -translate-x-1/2 rounded-full opacity-80 sm:top-10', tone.line)} />
    </div>
  )
}
