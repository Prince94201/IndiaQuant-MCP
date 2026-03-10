import './loggerHack.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { mcpTools, handleToolCall } from './tools/mcpTools.js';
import { initDb } from './db/database.js';

class IndiaQuantServer {
    private server: Server;

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
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('IndiaQuant MCP server running on stdio');
    }
}

const server = new IndiaQuantServer();
server.run().catch(console.error);
