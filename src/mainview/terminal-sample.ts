/**
 * What the mock shell's `sample` prints, and what the theme maker's terminal
 * shows: a box, shaded blocks, the sixteen colors, text styles, and wide
 * characters. It is for looking at how a terminal draws: the box must join
 * with no gaps, and the right edges of the wide rows must line up.
 */
export function terminalSample(): string {
	const colors = (base: number) => Array.from({ length: 8 }, (_, index) => `\x1b[${base + index}m\u2588\u2588\u2588`).join("") + "\x1b[0m";
	return [
		"\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510  \u256d\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256e",
		"\u2502 box      \u2502 drawing  \u2502  \u2502 round  \u2502",
		"\u251c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524  \u2502 \u2591\u2592\u2593\u2588\u2593\u2592 \u2502",
		"\u2502 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588 \u2502 \u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588 \u2502  \u2502 \u2588\u2588\u2588\u2588\u2588\u2588 \u2502",
		"\u2502 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588 \u2502 \u2588\u2587\u2586\u2585\u2584\u2583\u2582\u2581 \u2502  \u2502 \u2588\u2588\u2588\u2588\u2588\u2588 \u2502",
		"\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518  \u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256f",
		colors(30),
		colors(90),
		"plain \x1b[1mbold\x1b[0m \x1b[2mdim\x1b[0m \x1b[3mitalic\x1b[0m \x1b[4munderline\x1b[0m \x1b[7mreverse\x1b[0m \x1b[9mstrike\x1b[0m",
		"\u2502 wide \u6f22\u5b57 \u2502",
		"\u2502 wide \ud83d\ude80\ud83c\udf32 \u2502",
		"\u2502 wide abcd \u2502",
		"\ue0a0 main \uf07c ~/code \ue0b0 prompt symbols",
		"",
	].join("\r\n");
}
