import { ipcBridge } from '@/common';
import type { IConversationArtifact, IGeneratedFileArtifact } from '@/common/adapter/ipcBridge';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { resolvePreviewPayload } from '@/renderer/utils/file/previewPayload';
import { classifyPreviewError, previewErrorToI18nKey } from '@/renderer/utils/previewError';
import { Message } from '@arco-design/web-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { usePreviewContext } from '../context';
import { getContentTypeByExtension } from '../fileUtils';

const extensions = new Set([
  'html',
  'htm',
  'md',
  'markdown',
  'mdown',
  'mkd',
  'txt',
  'csv',
  'pdf',
  'docx',
  'xlsx',
  'pptx',
]);

/** Defense in depth: an artifact may only address a document in this project. */
export function isGeneratedArtifact(
  artifact: IConversationArtifact,
  conversationId: string,
  projectId: string
): artifact is IGeneratedFileArtifact {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) return false;
  if (!artifact.payload || typeof artifact.payload !== 'object' || Array.isArray(artifact.payload)) return false;
  if (artifact.kind !== 'generated_file' || artifact.status !== 'active' || artifact.conversation_id !== conversationId)
    return false;
  const { file, project_id, file_name } = artifact.payload;
  if (
    project_id !== projectId ||
    file?.kind !== 'project' ||
    !file.pe_id ||
    typeof file.relative_path !== 'string' ||
    typeof file_name !== 'string'
  )
    return false;
  const path = file.relative_path;
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    Array.from(path).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
    path.split('/').some((part) => part === '..' || !part) ||
    path.split('/').at(-1) !== file_name
  )
    return false;
  return extensions.has(file_name.split('.').at(-1)?.toLowerCase() ?? '');
}

/** Live and recovered outputs open through authenticated project I/O, never tool text. */
export default function GeneratedArtifactPreview({
  conversationId,
  projectId,
}: {
  conversationId: string;
  projectId?: string | null;
}): null {
  const auth = useAuth();
  const { openPreview } = usePreviewContext();
  const { t } = useTranslation();
  const scope =
    auth.status === 'authenticated' && auth.user?.id && projectId
      ? `${auth.user.id}:${conversationId}:${projectId}`
      : '';
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const handlers = useRef({ openPreview, t });
  handlers.current = { openPreview, t };

  useEffect(() => {
    if (!scope || !projectId) return;
    let alive = true;
    let version = 0;
    let liveVersion = 0;
    let recoveryVersion = 0;
    const seen = new Set<string>();
    const current = () => alive && currentScope.current === scope;
    const show = async (artifact: IConversationArtifact) => {
      if (!current() || !isGeneratedArtifact(artifact, conversationId, projectId)) return;
      const identity = `${artifact.id}:${artifact.updated_at}`;
      if (seen.has(identity)) return;
      seen.add(identity);
      const request = ++version;
      try {
        const contentType = getContentTypeByExtension(artifact.payload.file_name);
        const payload = await resolvePreviewPayload(artifact.payload.file, contentType);
        if (!current() || request !== version) return;
        handlers.current.openPreview(
          payload.content,
          contentType,
          {
            ...payload,
            fileRef: artifact.payload.file,
            file_name: artifact.payload.file_name,
            editable:
              contentType === 'html' || contentType === 'markdown' || contentType === 'code' || contentType === 'csv',
            generatedArtifact: true,
            saveIfMatch: payload.lastModified,
          },
          { replace: true, preserveDirty: true }
        );
      } catch (error) {
        if (!current() || request !== version) return;
        seen.delete(identity);
        Message.error(handlers.current.t(previewErrorToI18nKey(classifyPreviewError(error))));
      }
    };
    const unsubscribe = ipcBridge.conversation.artifactStream.on((artifact: IConversationArtifact) => {
      if (!isGeneratedArtifact(artifact, conversationId, projectId)) return;
      liveVersion++;
      void show(artifact);
    });
    const recover = () => {
      const recovery = ++recoveryVersion;
      const liveAtStart = liveVersion;
      void ipcBridge.conversation.listArtifacts
        .invoke({ conversation_id: conversationId })
        .then((artifacts) => {
          if (!current() || recovery !== recoveryVersion || liveAtStart !== liveVersion) return;
          const latest = artifacts
            .filter((artifact) => isGeneratedArtifact(artifact, conversationId, projectId))
            .toSorted((a, b) => a.created_at - b.created_at || a.updated_at - b.updated_at)
            .at(-1);
          if (latest) void show(latest);
        })
        .catch(() => {
          /* A missing/deleted conversation must not trigger filesystem reads. */
        });
    };
    recover();
    const onFocus = () => {
      recover();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      version++;
      unsubscribe();
      window.removeEventListener('focus', onFocus);
    };
  }, [scope, conversationId, projectId]);
  return null;
}
