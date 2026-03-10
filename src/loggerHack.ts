// IMPORTANT: MCP servers communicate via JSON-RPC on stdout.
// ANY package that uses console.log() or console.info() (like yahoo-finance2 notices)
// will pollute stdout and instantly break the MCP JSON parser in Claude Desktop.

// We MUST reroute all normal stdout logging to stderr (console.error) so it shows up
// safely as diagnostic logs without crashing the protocol!
console.log = console.error;
console.info = console.error;
