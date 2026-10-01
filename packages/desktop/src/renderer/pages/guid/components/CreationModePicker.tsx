import { Button } from '@arco-design/web-react';
import { Application, ArrowRight, Left, Right, Shop } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreationMode } from '../utils/creationModes';
import styles from '../index.module.css';

type Props = {
  modes: CreationMode[];
  selectedMode?: CreationMode;
  input: string;
  loading: boolean;
  onSelectMode: (id: string) => void;
  onSelectPrompt: (prompt: string) => void;
};

/** Mode overview and example gallery share published content and never send a message. */
export default function CreationModePicker({
  modes,
  selectedMode,
  input,
  loading,
  onSelectMode,
  onSelectPrompt,
}: Props) {
  const { t } = useTranslation();
  const [galleryModeId, setGalleryModeId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const cards =
    selectedMode?.items.filter((prompt) => prompt.type === 'prompt' && prompt.showInGallery !== false) ?? [];
  const galleryOpen = selectedMode?.id === galleryModeId && cards.length > 0;
  const pageCount = Math.ceil(cards.length / 3);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const suggestions =
    selectedMode?.items.filter((prompt) => prompt.type === 'prompt' && prompt.showInSuggestions !== false) ?? [];

  if (galleryOpen)
    return (
      <section className={styles.promptSection}>
        <div className={styles.galleryHeader}>
          <Button
            type='text'
            className={styles.galleryBack}
            aria-label={t('guid.creationModes.back')}
            disabled={loading}
            onClick={() => setGalleryModeId(null)}
          >
            <Left theme='outline' size='16' fill='currentColor' aria-hidden='true' />
            <span>{selectedMode.name}</span>
          </Button>
          <span className={styles.assistantPromptHint}>{t('guid.creationModes.examples')}</span>
        </div>
        <div className={styles.galleryTrack}>
          <div className={styles.promptGrid}>
            {cards.slice(currentPage * 3, currentPage * 3 + 3).map((prompt) => (
              <Button
                key={prompt.id}
                type='text'
                className={styles.promptCard}
                disabled={loading}
                aria-label={prompt.description ? `${prompt.title}. ${prompt.description}` : prompt.title}
                aria-pressed={input === prompt.content.text}
                onClick={() => onSelectPrompt(prompt.content.text)}
              >
                <span className={styles.promptArtwork} aria-hidden='true'>
                  <span className={styles.promptIcon}>
                    {prompt.icon ? (
                      <img src={prompt.icon} width='30' height='30' alt='' />
                    ) : (
                      <Application theme='outline' size='30' fill='currentColor' />
                    )}
                  </span>
                </span>
                <span className={styles.promptTitle}>{prompt.title}</span>
                {prompt.description ? <span className={styles.promptDescription}>{prompt.description}</span> : null}
              </Button>
            ))}
          </div>
          {pageCount > 1 ? (
            <Button
              type='outline'
              shape='circle'
              className={styles.galleryNext}
              disabled={loading}
              aria-label={t(
                currentPage + 1 === pageCount ? 'guid.creationModes.firstExamples' : 'guid.creationModes.moreExamples'
              )}
              onClick={() => setPage((currentPage + 1) % pageCount)}
            >
              {currentPage + 1 === pageCount ? (
                <Left theme='outline' size='18' fill='currentColor' aria-hidden='true' />
              ) : (
                <Right theme='outline' size='18' fill='currentColor' aria-hidden='true' />
              )}
            </Button>
          ) : null}
        </div>
      </section>
    );

  return (
    <section className={styles.modeOverview}>
      <div className={styles.widgetEntry}>
        {modes.map((mode) => (
          <Button
            key={mode.id}
            type='text'
            className={styles.widgetTile}
            aria-pressed={selectedMode?.id === mode.id}
            title={mode.description}
            disabled={loading}
            onClick={() => {
              onSelectMode(mode.id);
              setPage(0);
              setGalleryModeId(
                mode.items.some((prompt) => prompt.type === 'prompt' && prompt.showInGallery !== false) ? mode.id : null
              );
            }}
          >
            <span className={styles.modeArtwork} aria-hidden='true'>
              {mode.icon ? (
                <img src={mode.icon} width='28' height='28' alt='' />
              ) : mode.outputType === 'widget' ? (
                <Shop theme='outline' size='28' fill='currentColor' />
              ) : (
                <Application theme='outline' size='28' fill='currentColor' />
              )}
            </span>
            <span>{mode.name}</span>
          </Button>
        ))}
      </div>
      {selectedMode && suggestions.length > 0 ? (
        <div className={styles.modeSuggestions}>
          <p className={styles.assistantPromptHint}>
            {t('guid.creationModes.suggestions', { name: selectedMode.name })}
          </p>
          {suggestions.map((prompt) => (
            <Button
              key={prompt.id}
              type='text'
              className={styles.suggestionItem}
              disabled={loading}
              onClick={() => onSelectPrompt(prompt.content.text)}
            >
              <span>{prompt.content.text}</span>
              <ArrowRight theme='outline' size='16' fill='currentColor' aria-hidden='true' />
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
