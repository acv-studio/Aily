export const BOARD_SIZE = 15
export type Stone = 0 | 1 | 2
export type Player = 1 | 2

const CELL_COUNT = BOARD_SIZE * BOARD_SIZE
const CENTER = Math.floor(BOARD_SIZE / 2)
const AXES = [[0, 1], [1, 0], [1, 1], [1, -1]] as const

function validateBoard(board: readonly number[]): void {
  if (!board || board.length !== CELL_COUNT) {
    throw new Error(`Invalid Gomoku board: expected ${CELL_COUNT} cells`)
  }
  for (let index = 0; index < CELL_COUNT; index++) {
    if (board[index] !== 0 && board[index] !== 1 && board[index] !== 2) {
      throw new Error(`Invalid Gomoku board: cell ${index} must be 0, 1, or 2`)
    }
  }
}

function validatePlayer(player: Player): void {
  if (player !== 1 && player !== 2) throw new Error('Invalid Gomoku player: expected 1 or 2')
}

function inside(row: number, column: number): boolean {
  return row >= 0 && row < BOARD_SIZE && column >= 0 && column < BOARD_SIZE
}

/** A ray starts next to the real or hypothetical stone; coordinates prevent row wrapping. */
function ray(board: readonly number[], row: number, column: number, dr: number, dc: number, player: Player) {
  let count = 0
  row += dr
  column += dc
  while (inside(row, column) && board[row * BOARD_SIZE + column] === player) {
    count++
    row += dr
    column += dc
  }
  return { count, open: inside(row, column) && board[row * BOARD_SIZE + column] === 0 }
}

function winsAt(board: readonly number[], index: number, player: Player): boolean {
  const row = Math.floor(index / BOARD_SIZE)
  const column = index % BOARD_SIZE
  return AXES.some(([dr, dc]) => 1
    + ray(board, row, column, dr, dc, player).count
    + ray(board, row, column, -dr, -dc, player).count >= 5)
}

export function createGomokuBoard(): Stone[] {
  return Array<Stone>(CELL_COUNT).fill(0)
}

/** Standard freestyle Gomoku: five or more wins, including overlines for either player. */
export function hasGomokuWin(board: readonly number[], index: number, player: Player): boolean {
  validateBoard(board)
  validatePlayer(player)
  if (!Number.isInteger(index) || index < 0 || index >= CELL_COUNT) {
    throw new RangeError(`Invalid Gomoku index: expected an integer from 0 to ${CELL_COUNT - 1}`)
  }
  return board[index] === player && winsAt(board, index, player)
}

/** Draw means every cell is occupied; callers can check a win first for game outcome. */
export function isGomokuDraw(board: readonly number[]): boolean {
  validateBoard(board)
  return board.every(stone => stone !== 0)
}

function centerDistance(index: number): number {
  const row = Math.floor(index / BOARD_SIZE) - CENTER
  const column = index % BOARD_SIZE - CENTER
  return row * row + column * column
}

/** Score placing player at an empty index without ever changing the input board. */
function threatScore(board: readonly number[], index: number, player: Player) {
  const row = Math.floor(index / BOARD_SIZE)
  const column = index % BOARD_SIZE
  let score = 0
  let win = false
  let openThrees = 0
  let fours = 0
  for (const [dr, dc] of AXES) {
    const forward = ray(board, row, column, dr, dc, player)
    const backward = ray(board, row, column, -dr, -dc, player)
    const count = 1 + forward.count + backward.count
    const openEnds = Number(forward.open) + Number(backward.open)
    if (count >= 5) {
      win = true
      score += 1_000_000
    } else if (count === 4 && openEnds > 0) {
      fours++
      score += openEnds === 2 ? 100_000 : 15_000
    } else if (count === 3 && openEnds > 0) {
      if (openEnds === 2) openThrees++
      score += openEnds === 2 ? 5_000 : 500
    } else if (count === 2 && openEnds > 0) {
      score += openEnds === 2 ? 300 : 40
    } else if (openEnds === 2) {
      score += 10
    }
  }
  // Forks cannot usually be answered by one stone; freestyle Gomoku allows double threes.
  if (openThrees >= 2) score += 25_000
  if (fours >= 2) score += 200_000
  if (fours > 0 && openThrees > 0) score += 30_000
  return { score, win }
}

/**
 * Offline, deterministic one-ply opponent. Wins outrank all blocks; blocks outrank
 * positional play. Only empty cells within Chebyshev distance two of a stone are
 * scored. Equal scores prefer squared distance to center, then the lowest index.
 * No turn-count assumption: either color can be the computer, on any valid board.
 */
export function chooseGomokuMove(board: readonly number[], computer: Player = 2): number | null {
  validateBoard(board)
  validatePlayer(computer)
  let occupied = 0
  const candidates = new Set<number>()
  for (let index = 0; index < CELL_COUNT; index++) {
    const stone = board[index]
    if (stone === 0) continue
    occupied++
    // Check the whole position, not just its last move: terminal inputs must not play.
    if (winsAt(board, index, stone as Player)) return null
    const row = Math.floor(index / BOARD_SIZE)
    const column = index % BOARD_SIZE
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const nextRow = row + dr
        const nextColumn = column + dc
        if (!inside(nextRow, nextColumn)) continue
        const candidate = nextRow * BOARD_SIZE + nextColumn
        if (board[candidate] === 0) candidates.add(candidate)
      }
    }
  }
  if (occupied === 0) return CENTER * BOARD_SIZE + CENTER
  if (occupied === CELL_COUNT) return null

  const opponent: Player = computer === 1 ? 2 : 1
  let best: number | null = null
  let bestTier = -1
  let bestScore = -Infinity
  let bestDistance = Infinity
  for (const index of candidates) {
    const offense = threatScore(board, index, computer)
    const defense = threatScore(board, index, opponent)
    const tier = offense.win ? 2 : defense.win ? 1 : 0
    // A modest defense bias addresses dangerous open threes/fours before quiet attacks.
    const score = offense.score + defense.score * 1.15
    const distance = centerDistance(index)
    if (tier > bestTier || (tier === bestTier && (score > bestScore
      || (score === bestScore && (distance < bestDistance
        || (distance === bestDistance && (best === null || index < best))))))) {
      best = index
      bestTier = tier
      bestScore = score
      bestDistance = distance
    }
  }
  return best
}
