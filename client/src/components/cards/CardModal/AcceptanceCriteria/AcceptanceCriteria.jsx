/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React, { useCallback, useMemo, useState } from 'react';
import classNames from 'classnames';
import { shallowEqual, useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Checkbox, Icon } from 'semantic-ui-react';

import selectors from '../../../../selectors';
import entryActions from '../../../../entry-actions';
import { BoardMembershipRoles } from '../../../../constants/Enums';

import styles from './AcceptanceCriteria.module.scss';

const AcceptanceCriteria = React.memo(() => {
  const card = useSelector(selectors.selectCurrentCard);
  const { canEdit } = useSelector((state) => {
    const boardMembership = selectors.selectCurrentUserMembershipForCurrentBoard(state);
    const isEditor = !!boardMembership && boardMembership.role === BoardMembershipRoles.EDITOR;
    return { canEdit: isEditor };
  }, shallowEqual);

  const dispatch = useDispatch();
  const [t] = useTranslation();
  const [newCriterionName, setNewCriterionName] = useState('');

  const criteria = useMemo(() => card.acceptanceCriteria || [], [card.acceptanceCriteria]);

  const completedCount = criteria.filter((c) => c.isCompleted).length;
  const totalCount = criteria.length;
  const showProgress = totalCount > 0;

  const handleToggleCriterion = useCallback(
    (index) => {
      const newCriteria = [...criteria];
      newCriteria[index] = {
        ...newCriteria[index],
        isCompleted: !newCriteria[index].isCompleted,
      };
      dispatch(
        entryActions.updateCurrentCard({
          acceptanceCriteria: newCriteria,
        }),
      );
    },
    [criteria, dispatch],
  );

  const handleUpdateCriterionName = useCallback(
    (index, name) => {
      const newCriteria = [...criteria];
      newCriteria[index] = {
        ...newCriteria[index],
        name: name.trim() || newCriteria[index].name,
      };
      dispatch(
        entryActions.updateCurrentCard({
          acceptanceCriteria: newCriteria,
        }),
      );
    },
    [criteria, dispatch],
  );

  const handleDeleteCriterion = useCallback(
    (index) => {
      const newCriteria = criteria.filter((_, i) => i !== index);
      dispatch(
        entryActions.updateCurrentCard({
          acceptanceCriteria: newCriteria.length ? newCriteria : null,
        }),
      );
    },
    [criteria, dispatch],
  );

  const handleMoveUp = useCallback(
    (index) => {
      if (index === 0) return;
      const newCriteria = [...criteria];
      [newCriteria[index - 1], newCriteria[index]] = [newCriteria[index], newCriteria[index - 1]];
      dispatch(
        entryActions.updateCurrentCard({
          acceptanceCriteria: newCriteria,
        }),
      );
    },
    [criteria, dispatch],
  );

  const handleMoveDown = useCallback(
    (index) => {
      if (index === criteria.length - 1) return;
      const newCriteria = [...criteria];
      [newCriteria[index], newCriteria[index + 1]] = [newCriteria[index + 1], newCriteria[index]];
      dispatch(
        entryActions.updateCurrentCard({
          acceptanceCriteria: newCriteria,
        }),
      );
    },
    [criteria, dispatch],
  );

  const handleAddCriterion = useCallback(() => {
    const name = newCriterionName.trim();
    if (!name) return;

    const newCriterion = {
      id: Date.now().toString(),
      name,
      isCompleted: false,
      position: criteria.length,
    };
    const newCriteria = [...criteria, newCriterion];
    dispatch(
      entryActions.updateCurrentCard({
        acceptanceCriteria: newCriteria,
      }),
    );
    setNewCriterionName('');
  }, [newCriterionName, criteria, dispatch]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddCriterion();
      }
    },
    [handleAddCriterion],
  );

  if (!canEdit && !totalCount) {
    return null;
  }

  return (
    <div className={styles.contentModule}>
      <div className={styles.moduleWrapper}>
        <Icon name="tasks" className={styles.moduleIcon} />
        <div className={styles.moduleHeader}>
          <span>{t('common.acceptanceCriteria')}</span>
          {showProgress && (
            <span className={styles.progress}>
              {completedCount}/{totalCount} {t('common.done')}
            </span>
          )}
        </div>
        <div className={styles.list}>
          {criteria.map((criterion, index) => (
            <div
              key={criterion.id || index}
              className={classNames(styles.item, criterion.isCompleted && styles.itemCompleted)}
            >
              <div className={styles.itemContent}>
                <Checkbox
                  checked={criterion.isCompleted}
                  disabled={!canEdit}
                  onChange={() => handleToggleCriterion(index)}
                />
                <input
                  type="text"
                  className={styles.itemInput}
                  value={criterion.name}
                  onChange={(e) => handleUpdateCriterionName(index, e.target.value)}
                  readOnly={!canEdit}
                  placeholder={t('common.acceptanceCriterionPlaceholder')}
                />
              </div>
              {canEdit && (
                <div className={styles.itemActions}>
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={() => handleMoveUp(index)}
                    disabled={index === 0}
                    title={t('action.moveUp')}
                  >
                    <Icon name="arrow up" size="small" />
                  </button>
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={() => handleMoveDown(index)}
                    disabled={index === criteria.length - 1}
                    title={t('action.moveDown')}
                  >
                    <Icon name="arrow down" size="small" />
                  </button>
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={() => handleDeleteCriterion(index)}
                    title={t('action.delete')}
                  >
                    <Icon name="trash alternate outline" size="small" />
                  </button>
                </div>
              )}
            </div>
          ))}
          {canEdit && (
            <div className={styles.addItem}>
              <div className={styles.addItemContent}>
                <Icon name="check square outline" className={styles.addIcon} />
                <input
                  type="text"
                  className={styles.addItemInput}
                  value={newCriterionName}
                  onChange={(e) => setNewCriterionName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t('common.addAcceptanceCriterion')}
                />
                <button
                  type="button"
                  className={styles.addButton}
                  onClick={handleAddCriterion}
                  disabled={!newCriterionName.trim()}
                >
                  <Icon name="add" size="small" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default AcceptanceCriteria;
