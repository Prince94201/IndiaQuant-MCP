import './loggerHack.js';
import express from 'express';
import cors from 'cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { mcpTools, handleToolCall } from './tools/mcpTools.js';
import { initDb } from './db/database.js';

class IndiaQuantServer {
    private server: Server;
    private transport?: SSEServerTransport;

    constructor() {
        this.server = new Server(
            {
                name: 'indiaquant-mcp',
                version: '1.0.0',
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );

        this.setupToolHandlers();

        this.server.onerror = (error) => console.error('[MCP Error]', error);
        process.on('SIGINT', async () => {
            await this.server.close();
            process.exit(0);
        });
    }

    private setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: mcpTools,
        }));

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
                const { name, arguments: args } = request.params;
                const result = await handleToolCall(name, args || {});
                return {
                    content: [
                        {
                            type: 'text',
                            text: result,
                        },
                    ],
                };
            } catch (error) {
                let message = 'Unknown error';
                if (error instanceof Error) message = error.message;

                return {
                    isError: true,
                    content: [
                        {
                            type: 'text',
                            text: message,
                        },
                    ],
                };
            }
        });
    }

    async run() {
        await initDb();
        
        // If running locally via stdio (Claude Desktop)
        if (process.argv.includes('--stdio')) {
            const transport = new StdioServerTransport();
            await this.server.connect(transport);
            console.error('IndiaQuant MCP server running on stdio');
            return;
        }

        // Otherwise, run as HTTP/SSE server (for Render execution)
        const app = express();
        
        // Enable CORS for external connections
        app.use(cors());

        // Basic health check endpoint for the root URL
        app.get('/', (req, res) => {
            res.send('IndiaQuant MCP Server is running!');
        });

        app.get('/sse', async (req, res) => {
            console.log('New SSE connection established');
            this.transport = new SSEServerTransport('/message', res);
            await this.server.connect(this.transport);
        });

        app.post('/message', async (req, res) => {
            if (!this.transport) {
                res.status(400).send('SSE Connection not established yet.');
                return;
            }
            await this.transport.handlePostMessage(req, res);
        });

        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`IndiaQuant MCP HTTP server running on port ${PORT}`);
            console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
        });
    }
}

const server = new IndiaQuantServer();
server.run().catch(console.error);
