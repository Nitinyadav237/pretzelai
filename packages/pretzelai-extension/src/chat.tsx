/*
 * Copyright (c) Pretzel AI GmbH.
 * This file is part of the Pretzel project and is licensed under the
 * GNU Affero General Public License version 3.
 * See the LICENSE_AGPLv3 file at the root of the project for the full license text.
 * Contributions by contributors listed in the PRETZEL_CONTRIBUTORS file (found at
 * the root of the project) are licensed under AGPLv3.
 */

import React, { useState } from 'react';
import { ReactWidget } from '@jupyterlab/apputils';
import { LabIcon } from '@jupyterlab/ui-components';
import pretzelSvg from '../style/icons/pretzel.svg';
import { Box, IconButton, TextField, Typography } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import { CHAT_SYSTEM_MESSAGE, chatAIStream } from './chatAIUtils';
import { ChatCompletionMessage } from 'openai/resources';
import { INotebookTracker } from '@jupyterlab/notebook';
import { JupyterFrontEnd } from '@jupyterlab/application';
import { getSelectedCode } from './utils';
import { RendermimeMarkdown } from './rendermime-markdown';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { AiService, getTopSimilarities } from './prompt';
import { OpenAI } from 'openai';
import { OpenAIClient } from '@azure/openai';

const pretzelIcon = new LabIcon({
  name: 'pretzelai::chat',
  svgstr: pretzelSvg
});

interface IMessage {
  id: string;
  content: string;
  role: 'user' | 'assistant' | 'system';
}

const initialMessage: IMessage[] = [{ id: '1', content: 'Hello, how can I assist you today?', role: 'assistant' }];

interface IChatProps {
  aiService: AiService;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  openAiModel?: string;
  azureBaseUrl?: string;
  azureApiKey?: string;
  deploymentId?: string;
  notebookTracker: INotebookTracker;
  app: JupyterFrontEnd;
  rmRegistry: IRenderMimeRegistry;
  aiClient: OpenAI | OpenAIClient | null;
  codeMatchThreshold: number;
}

export function Chat({
  aiService,
  openAiApiKey,
  openAiBaseUrl,
  openAiModel,
  azureBaseUrl,
  azureApiKey,
  deploymentId,
  notebookTracker,
  app,
  rmRegistry,
  aiClient,
  codeMatchThreshold
}: IChatProps): JSX.Element {
  const [messages, setMessages] = useState(initialMessage);
  const [input, setInput] = useState('');

  const onSend = async () => {
    const activeCellCode = notebookTracker?.activeCell?.model?.sharedModel?.source;
    const notebook = notebookTracker.currentWidget;
    const currentNotebookPath = notebook!.context.path;
    const notebookName = currentNotebookPath.split('/').pop()!.replace('.ipynb', '');
    const currentDir = currentNotebookPath.substring(0, currentNotebookPath.lastIndexOf('/'));
    const embeddingsFolderName = '.embeddings';
    const embeddingsPath = currentDir + '/' + embeddingsFolderName + '/' + notebookName + '_embeddings.json';

    const file = await app.serviceManager.contents.get(embeddingsPath);
    const embeddings = JSON.parse(file.content);
    const selectedCode = getSelectedCode(notebookTracker).extractedCode;

    const formattedMessages = [
      {
        role: 'system',
        content: CHAT_SYSTEM_MESSAGE
      },
      ...messages.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      { role: 'user', content: input }
    ];

    const newMessage = {
      id: String(messages.length + 1),
      content: input,
      role: 'user'
    };

    setMessages(prevMessages => [...prevMessages, newMessage as IMessage]);
    setInput('');

    const topSimilarities = await getTopSimilarities(
      input,
      embeddings,
      5,
      aiClient,
      aiService,
      'no-match-id',
      codeMatchThreshold
    );

    await chatAIStream({
      aiService,
      openAiApiKey,
      openAiBaseUrl,
      openAiModel,
      azureBaseUrl,
      azureApiKey,
      deploymentId,
      renderChat,
      messages: formattedMessages as ChatCompletionMessage[],
      topSimilarities,
      activeCellCode,
      selectedCode
    });
  };

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      onSend();
      event.stopPropagation();
      event.preventDefault();
    }
  }

  const renderChat = (chunk: string) => {
    setMessages(prevMessages => {
      const updatedMessages = [...prevMessages];
      const lastMessage = updatedMessages[updatedMessages.length - 1];

      if (lastMessage.role === 'user') {
        const aiMessage = {
          id: String(updatedMessages.length + 1),
          content: chunk,
          role: 'assistant'
        };
        updatedMessages.push(aiMessage as IMessage);
      } else if (lastMessage.role === 'assistant') {
        lastMessage.content += chunk;
      }

      return updatedMessages;
    });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ flexGrow: 1, overflowY: 'auto', padding: 2 }}>
        {}
        {messages.map(message => (
          <Box key={message.id} sx={{ marginBottom: 2 }}>
            <Typography sx={{ fontWeight: 'bold' }} color={message.role === 'user' ? 'primary' : 'textSecondary'}>
              {message.role === 'user' ? 'You' : 'Pretzel AI'}
            </Typography>
            <RendermimeMarkdown rmRegistry={rmRegistry} markdownStr={message.content} />
          </Box>
        ))}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', padding: 1 }}>
        <TextField
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          fullWidth
          placeholder="Type message to ask AI..."
        />
        <IconButton onClick={onSend}>
          <SendIcon />
        </IconButton>
      </Box>
    </Box>
  );
}

export function createChat(props: IChatProps): ReactWidget {
  const widget = ReactWidget.create(<Chat {...props} />);
  widget.id = 'pretzelai::chat';
  widget.title.icon = pretzelIcon;
  widget.title.caption = 'Pretzel AI Chat';
  return widget;
}