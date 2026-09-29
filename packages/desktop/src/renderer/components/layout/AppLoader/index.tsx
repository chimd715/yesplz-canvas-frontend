import React from 'react';
import { useTranslation } from 'react-i18next';
import blackAnimation from '@renderer/assets/logos/brand/poodle-loading-black.gif';
import blackStill from '@renderer/assets/logos/brand/poodle-loading-black.png';
import orangeAnimation from '@renderer/assets/logos/brand/poodle-loading-orange.gif';
import orangeStill from '@renderer/assets/logos/brand/poodle-loading-orange.png';
import styles from './AppLoader.module.css';

/** Supplied mascot; a still frame respects the device's reduced-motion preference. */
export const LoadingMascot: React.FC<{ accent?: boolean }> = ({ accent = false }) => (
  <picture className={`${styles.mascot} ${accent ? '' : styles.neutral}`} aria-hidden='true'>
    <source media='(prefers-reduced-motion: reduce)' srcSet={accent ? orangeStill : blackStill} />
    <img src={accent ? orangeAnimation : blackAnimation} alt='' width='72' height='63' />
  </picture>
);

const AppLoader: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className={styles.loader} role='status' aria-live='polite'>
      <LoadingMascot />
      <span className={styles.label}>{t('common.loading')}</span>
    </div>
  );
};

export default AppLoader;
