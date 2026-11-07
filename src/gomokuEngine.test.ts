import { describe, expect, it } from 'vitest'
import {
  BOARD_SIZE, chooseGomokuMove, createGomokuBoard, hasGomokuWin, isGomokuDraw,
  type Player, type Stone,
} from './gomokuEngine'

const at = (row: number, column: number) => row * BOARD_SIZE + column
const axes = [[0, 1], [1, 0], [1, 1], [1, -1]] as const
function line(board: Stone[], row: number, column: number, dr: number, dc: number, count: number, player: Player) {
  for (let offset = 0; offset < count; offset++) board[at(row + dr * offset, column + dc * offset)] = player
  return board
}
function fullDrawBoard(): Stone[] {
  return Array.from({ length: BOARD_SIZE ** 2 }, (_, index) =>
    (1 + ((Math.floor(index / BOARD_SIZE) + Math.floor((index % BOARD_SIZE) / 2)) % 2)) as Stone)
}

describe('Gomoku board and rules', () => {
  it('exports a 15 by 15 board of empty stones', () => {
    expect(BOARD_SIZE).toBe(15)
    expect(createGomokuBoard()).toEqual(Array(225).fill(0))
  })
  it('creates independent boards', () => {
    const first = createGomokuBoard()
    const second = createGomokuBoard()
    first[0] = 1
    expect(second[0]).toBe(0)
  })
  it.each(axes)('recognizes black five along axis (%i, %i)', (dr, dc) => {
    const board = line(createGomokuBoard(), 3, 8, dr, dc, 5, 1)
    expect(hasGomokuWin(board, at(3 + dr * 2, 8 + dc * 2), 1)).toBe(true)
  })
  it.each(axes)('recognizes white five along axis (%i, %i)', (dr, dc) => {
    const board = line(createGomokuBoard(), 3, 8, dr, dc, 5, 2)
    expect(hasGomokuWin(board, at(3 + dr * 4, 8 + dc * 4), 2)).toBe(true)
  })
  it.each(axes)('does not count four as five along axis (%i, %i)', (dr, dc) => {
    const board = line(createGomokuBoard(), 3, 8, dr, dc, 4, 1)
    expect(hasGomokuWin(board, at(3, 8), 1)).toBe(false)
  })
  it.each([1, 2] as const)('allows overlines for player %i (no Renju prohibition)', player => {
    const board = line(createGomokuBoard(), 0, 2, 0, 1, 7, player)
    expect(hasGomokuWin(board, at(0, 5), player)).toBe(true)
  })
  it('does not wrap a horizontal sequence through the right edge', () => {
    const board = createGomokuBoard()
    for (const index of [13, 14, 15, 16, 17]) board[index] = 1
    expect(hasGomokuWin(board, 15, 1)).toBe(false)
  })
  it('does not wrap a descending diagonal through the right edge', () => {
    const board = createGomokuBoard()
    for (const index of [13, 29, 45, 61, 77]) board[index] = 2
    expect(hasGomokuWin(board, 45, 2)).toBe(false)
  })
  it('does not wrap an ascending diagonal through the left edge', () => {
    const board = createGomokuBoard()
    for (const index of [30, 44, 58, 72, 86]) board[index] = 1
    expect(hasGomokuWin(board, 58, 1)).toBe(false)
  })
  it('counts a five on the bottom-right boundary', () => {
    const board = line(createGomokuBoard(), 14, 10, 0, 1, 5, 2)
    expect(hasGomokuWin(board, 224, 2)).toBe(true)
  })
  it('does not infer a win at an empty cell or the other player', () => {
    const board = line(createGomokuBoard(), 7, 3, 0, 1, 5, 1)
    expect(hasGomokuWin(board, at(7, 8), 1)).toBe(false)
    expect(hasGomokuWin(board, at(7, 5), 2)).toBe(false)
  })
  it('does not bridge a gap or opponent stone', () => {
    const board = line(createGomokuBoard(), 7, 3, 0, 1, 6, 1)
    board[at(7, 5)] = 0
    expect(hasGomokuWin(board, at(7, 6), 1)).toBe(false)
    board[at(7, 5)] = 2
    expect(hasGomokuWin(board, at(7, 6), 1)).toBe(false)
  })
  it('reports draw only when every cell is filled', () => {
    const board = fullDrawBoard()
    expect(isGomokuDraw(board)).toBe(true)
    expect(board.some((stone, index) => hasGomokuWin(board, index, stone as Player))).toBe(false)
    board[112] = 0
    expect(isGomokuDraw(board)).toBe(false)
    expect(isGomokuDraw(createGomokuBoard())).toBe(false)
  })
})

describe('offline computer moves', () => {
  it.each([1, 2] as const)('starts at center for computer %i', computer => {
    expect(chooseGomokuMove(createGomokuBoard(), computer)).toBe(112)
  })
  it('defaults to white and takes its immediate win before blocking black', () => {
    const board = createGomokuBoard()
    line(board, 3, 3, 0, 1, 4, 2)
    board[at(3, 2)] = 1
    line(board, 10, 3, 0, 1, 4, 1)
    board[at(10, 2)] = 2
    expect(chooseGomokuMove(board)).toBe(at(3, 7))
  })
  it.each(axes)('blocks an immediate opponent win along (%i, %i)', (dr, dc) => {
    const board = line(createGomokuBoard(), 4, 8, dr, dc, 4, 1)
    board[at(4 - dr, 8 - dc)] = 2
    expect(chooseGomokuMove(board)).toBe(at(4 + dr * 4, 8 + dc * 4))
  })
  it.each(axes)('wins immediately along (%i, %i)', (dr, dc) => {
    const board = line(createGomokuBoard(), 4, 8, dr, dc, 4, 2)
    board[at(4 - dr, 8 - dc)] = 1
    expect(chooseGomokuMove(board)).toBe(at(4 + dr * 4, 8 + dc * 4))
  })
  it('fills a broken four to block rather than only extending contiguous runs', () => {
    const board = createGomokuBoard()
    for (const column of [4, 5, 7, 8]) board[at(7, column)] = 1
    expect(chooseGomokuMove(board)).toBe(at(7, 6))
  })
  it('supports a black computer blocking white', () => {
    const board = line(createGomokuBoard(), 6, 4, 0, 1, 4, 2)
    board[at(6, 3)] = 1
    expect(chooseGomokuMove(board, 1)).toBe(at(6, 8))
  })
  it('chooses one legal immediate block when an open four has two winning ends', () => {
    const board = line(createGomokuBoard(), 7, 5, 0, 1, 4, 1)
    expect(chooseGomokuMove(board)).toBe(at(7, 9))
  })
  it('creates an open four from its own open three', () => {
    const board = line(createGomokuBoard(), 7, 5, 0, 1, 3, 2)
    expect(chooseGomokuMove(board)).toBe(at(7, 8))
  })
  it('creates a double open three at a cross', () => {
    const board = createGomokuBoard()
    for (const [row, column] of [[7, 6], [7, 8], [6, 7], [8, 7]]) board[at(row, column)] = 2
    expect(chooseGomokuMove(board)).toBe(112)
  })
  it('defends against an opponent double open three', () => {
    const board = createGomokuBoard()
    for (const [row, column] of [[7, 6], [7, 8], [6, 7], [8, 7]]) board[at(row, column)] = 1
    expect(chooseGomokuMove(board)).toBe(112)
  })
  it('prefers defending an open-three opportunity over a comparable quiet attack', () => {
    const board = line(createGomokuBoard(), 5, 6, 0, 1, 2, 1)
    line(board, 10, 3, 0, 1, 2, 2)
    expect(chooseGomokuMove(board)).toBe(at(5, 8))
  })
  it('breaks equal scores by center distance then lowest index', () => {
    const board = createGomokuBoard()
    board[112] = 2
    expect(chooseGomokuMove(board)).toBe(97)
  })
  it('uses nearby legal cells, including when stones are at a corner', () => {
    const board = createGomokuBoard()
    board[0] = 2
    const move = chooseGomokuMove(board)!
    expect(move).toBe(16)
    expect(board[move]).toBe(0)
    expect(Math.floor(move / BOARD_SIZE)).toBeLessThanOrEqual(2)
    expect(move % BOARD_SIZE).toBeLessThanOrEqual(2)
  })
  it('is deterministic on a scattered nonterminal position and stays within two steps', () => {
    const board = createGomokuBoard()
    const stones = [at(2, 2), at(5, 6), at(8, 9), at(12, 11)]
    stones.forEach((index, offset) => { board[index] = offset % 2 ? 2 : 1 })
    const move = chooseGomokuMove(board)!
    expect(board[move]).toBe(0)
    expect(stones.some(index => Math.abs(Math.floor(index / 15) - Math.floor(move / 15)) <= 2
      && Math.abs(index % 15 - move % 15) <= 2)).toBe(true)
    for (let repeat = 0; repeat < 10; repeat++) expect(chooseGomokuMove(board)).toBe(move)
  })
  it('returns the only empty cell on a nearly full nonterminal board', () => {
    const board = fullDrawBoard()
    board[112] = 0
    expect(chooseGomokuMove(board)).toBe(112)
  })
  it('returns null for a full draw', () => {
    expect(chooseGomokuMove(fullDrawBoard())).toBeNull()
  })
  it.each([1, 2] as const)('returns null when player %i has already won, even with empties', player => {
    const board = line(createGomokuBoard(), 2, 3, 0, 1, 5, player)
    expect(chooseGomokuMove(board, 1)).toBeNull()
    expect(chooseGomokuMove(board, 2)).toBeNull()
  })
  it('returns null for an existing overline', () => {
    expect(chooseGomokuMove(line(createGomokuBoard(), 1, 1, 1, 1, 6, 2))).toBeNull()
  })
  it('never mutates frozen inputs for rules, draw checks, or move selection', () => {
    const board = line(createGomokuBoard(), 5, 5, 0, 1, 3, 1)
    const snapshot = [...board]
    Object.freeze(board)
    expect(hasGomokuWin(board, at(5, 6), 1)).toBe(false)
    expect(isGomokuDraw(board)).toBe(false)
    expect(chooseGomokuMove(board)).not.toBeNull()
    expect(board).toEqual(snapshot)
  })
})

describe('input validation', () => {
  const helpers = [
    (board: readonly number[]) => hasGomokuWin(board, 0, 1),
    (board: readonly number[]) => isGomokuDraw(board),
    (board: readonly number[]) => chooseGomokuMove(board),
  ]
  it.each([0, 224, 226])('rejects board length %i in every board-consuming helper', length => {
    for (const helper of helpers) expect(() => helper(Array(length).fill(0))).toThrow(/Invalid Gomoku board.*225/)
  })
  it.each([-1, 3, 0.5, NaN, Infinity, '1', undefined, null])('rejects invalid entry %s', value => {
    const board: unknown[] = createGomokuBoard()
    board[42] = value
    for (const helper of helpers) expect(() => helper(board as number[])).toThrow(/cell 42 must be 0, 1, or 2/)
  })
  it('rejects sparse boards and missing boards clearly', () => {
    for (const helper of helpers) {
      expect(() => helper(Array(225))).toThrow(/Invalid Gomoku board/)
      expect(() => helper(null as unknown as number[])).toThrow(/Invalid Gomoku board/)
    }
  })
  it('validates all entries before returning null for an early terminal line', () => {
    const board: number[] = line(createGomokuBoard(), 0, 0, 0, 1, 5, 1)
    board[224] = 9
    expect(() => chooseGomokuMove(board)).toThrow(/cell 224/)
  })
  it.each([-1, 225, 1.5, NaN])('rejects invalid win-check index %s', index => {
    expect(() => hasGomokuWin(createGomokuBoard(), index, 1)).toThrow(/Invalid Gomoku index/)
  })
  it('rejects invalid players at runtime', () => {
    expect(() => chooseGomokuMove(createGomokuBoard(), 0 as Player)).toThrow(/Invalid Gomoku player/)
    expect(() => hasGomokuWin(createGomokuBoard(), 0, 3 as Player)).toThrow(/Invalid Gomoku player/)
  })
})
