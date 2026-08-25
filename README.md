# colordoku

a sudoku-like game where the objective is to locate all the hidden queens,
implemented for the web.

## the game

to play the game, clone this repo, then run `npm run dev` in your terminal from
the repo root. if you navigate to the url prompted in your terminal (usually
`https://localhost:5173`) you'll see a game board generated.

### rules

given a square board containing a grid of `n` cells on each size partitioned
into `n` regions of varying sizes, your job is to find the `n` queens without
making too many incorrect guesses. use the following rules to guide you in
locating each queen without errors:

1. every column, row, & region contains exactly 1 queen.
2. no two queens can be adjacent (orthogonally _or_ diagonally).

### an example

suppose you have a simple board of 4 cells on each side (meaning 4 regions & 4
queens). it might be represented as 4 lines, with each space-separated letter
(`A`, `B`, `C`, or `D`) denoting a cell. additionally, you will see a row of
circles above the board (in this case, 2) indicating how many incorrect guesses
you have left before you lose.

```
  O O

B B B B
A B C C
C B C D
C C C D
```

because each region _must_ have exactly 1 queen, we know that the region `A`
has only one possible location for a queen. let's mark it with a `Q` for queen:

```
  O O

B B B B
Q B C C
C B C D
C C C D
```

next, because each row & column can contain only one queen, we know the top row
& left column can not contain a queen. additionally, the `B` cell in the 2nd
position of the 2nd column from the left & top can not contain a queen either
as it is diagonally adjacent to the queen we found in `A`. let's mark all of
those with an `x` to eliminate them.

```
  O O

x x B B
Q x x x
x x C D
x C C D
```

now with those eliminated we can use row/column portions of the same rule about
the `B` region & simlar about `D` to find 2 more queens; however, let's first
see what an incorrect guess looks like. let's try guessing that the `C` cell in
the 3rd from the left position in the bottom row is a queen.

```
  O X

x x B B
Q x x x
x x C D
x C x D
```

note how it will actually be marked with an `x` after our incorrect guess,
indicating we were wrong & eliminating the cell for us automatically.
additionally, see that the row of guesses in the top had one replaced with an
`X` &mdash; this shows us that we have only one incorrect guess left before we
lose.

now let us proceed to solve the puzzle. remember rule (1) above, where each
row/column must contain exactly 1 queen; this means that the right column can
only contain `D` cells since the `D` region exists only in that column. let's
eliminate all other cells in that column.

```
  O X

x x B x
Q x x x
x x C D
x C x D
```

now there's only one `B`, so we can mark it as a queen & eliminate all other
cells in the same column.

```
  O X

x x Q x
Q x x x
x x x D
x C x D
```

same thing with `C` will eliminate the bottom `D`, leaving only one possibility
for the last queen as well. let's mark them both to win the game.

```
  O X

x x Q x
Q x x x
x x x Q
x Q x x
```

## the implementation

DOM manipulation & game state logic are written in typescript with the view
implemented in html & css, all built with vite. board generation is being
implemented as a WASM module in rust to leverage faster computation when
building a board w/ a guarantee of exactly one possible solution.

### TODO

- [ ] UI to start a new game
- [ ] UI indicating a game was won or lost
- [ ] board generation module
- [ ] UI for giving a board size & generating a board to match
- [ ] a difficulty modifier that can influence board generation & max number of
      incorrect guesses allowed
- [ ] long term score tracking (using localstate)
