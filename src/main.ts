import "./style.css";
import { newBoard } from "./board/board";

const app = document.querySelector("#app")!;
const board = newBoard(4); // FIXME: given size does nothing right now!

app.append(board.html);
