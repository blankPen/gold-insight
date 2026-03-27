import * as readline from 'readline';
import OpenAI from 'openai';
import * as ai from '../src/ai/';

// const client = new OpenAI({
//   apiKey: config.ai.apiKey,
//   baseURL: config.ai.baseUrl,
// });

// const history: OpenAI.ChatCompletionMessageParam[] = [
//   {
//     role: 'system',
//     content: '你是一位专业的黄金市场分析师，擅长技术分析和基本面分析。用户可能会问你关于黄金价格走势、技术指标、操作建议等问题。请用简洁的中文回复。',
//   },
// ];

// const rl = readline.createInterface({
//   input: process.stdin,
//   output: process.stdout,
// });

// console.log('═══════════════════════════════════════════');
// console.log('  AI Chat Test — Gold Price Analyzer');
// console.log(`  Provider: ${config.ai.baseUrl}`);
// console.log(`  Model:    ${config.ai.model}`);
// console.log('═══════════════════════════════════════════');
// console.log('输入消息开始对话，输入 /quit 退出\n');

// function prompt() {
//   rl.question('你> ', async (input) => {
//     const text = input.trim();
//     if (!text) return prompt();
//     if (text === '/quit' || text === '/exit') {
//       console.log('\n再见!');
//       rl.close();
//       return;
//     }

//     if (text === '/clear') {
//       history.splice(1);
//       console.log('[系统] 对话历史已清除\n');
//       return prompt();
//     }

//     history.push({ role: 'user', content: text });

//     try {
//       process.stdout.write('\nAI> ');
//       const stream = await client.chat.completions.create({
//         model: config.ai.model,
//         messages: history,
//         temperature: 0.7,
//         max_tokens: 1024,
//         stream: true,
//       });

//       let fullResponse = '';
//       for await (const chunk of stream) {
//         const delta = chunk.choices?.[0]?.delta?.content ?? '';
//         if (delta) {
//           process.stdout.write(delta);
//           fullResponse += delta;
//         }
//       }
//       console.log('\n');

//       history.push({ role: 'assistant', content: fullResponse });
//     } catch (err: any) {
//       console.error(`\n[错误] ${err.status ?? ''} ${err.message}\n`);
//       history.pop(); // remove the failed user message
//     }

//     prompt();
//   });
// }

// prompt();


ai.getAIProvider().ask([
  {
    role: 'system',
    content: '你是一位专业的黄金市场分析师，擅长技术分析和基本面分析。用户可能会问你关于黄金价格走势、技术指标、操作建议等问题。请用简洁的中文回复。',
  },
  {
    role: 'user',
    content: '你好，我想知道黄金价格走势如何？',
  },
]).then(console.log);