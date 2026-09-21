import React, { useState, useEffect } from 'react';
import { Clock, Filter, RefreshCw, Shield, AlertTriangle } from 'lucide-react';
import { api, formatDateTime } from '../api.js';
import { Page, Loader, Empty } from '../components/UI.jsx';
import { useToast } from '../context/ToastContext.jsx';

const ACTIONS = [
  'ALL',
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGOUT',
  'TASK_CREATED',
  'TASK_UPDATED',
  'TASK_DELETED',
  'TASK_ARCHIVED',
  'APPLICATION_CREATED',
  'APPLICATION_WITHDRAWN',
  'APPLICATION_STATUS_CHANGED',
  'COMPLETION_SUBMITTED',
  'COMPLETION_CONFIRMED',
  'POINTS_MANUALLY_ISSUED',
  'USER_CREATED',
  'USER_UPDATED',
  'PASSWORD_RESET_BY_ADMIN',
  'PASSWORD_CHANGED'
];

const ENTITIES = ['ALL', 'AUTH', 'TASK', 'APPLICATION', 'POINT', 'USER'];

export default function AdminAudit() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('ALL');
  const [entityFilter, setEntityFilter] = useState('ALL');
  const [expandedLogId, setExpandedLogId] = useState(null);
  const toast = useToast();

  const toggleExpand = (id) => {
    setExpandedLogId(expandedLogId === id ? null : id);
  };

  const loadAudit = async () => {
    try {
      setLoading(true);
      const query = new URLSearchParams();
      if (actionFilter !== 'ALL') query.set('action', actionFilter);
      if (entityFilter !== 'ALL') query.set('entity_type', entityFilter);
      query.set('limit', '250');

      const res = await api(`/audit?${query.toString()}`);
      setLogs(res);
    } catch (err) {
      toast.error('Не удалось загрузить журнал аудита: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAudit();
  }, [actionFilter, entityFilter]);

  return (
    <Page
      title="Журнал аудита безопасности"
      subtitle="Неизменяемая хроника всех ключевых событий системы: авторизации, назначения, начисления баллов и изменение ролей."
      actions={
        <button className="btn ghost" onClick={loadAudit} disabled={loading}>
          <RefreshCw size={15} /> Обновить
        </button>
      }
    >
      {/* Filters Toolbar */}
      <div className="toolbar">
        <div className="toolbar-filters">
          <div className="category-select-wrap">
            <Filter size={14} />
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
            >
              {ACTIONS.map((act) => (
                <option key={act} value={act}>
                  {act === 'ALL' ? 'Все действия' : act}
                </option>
              ))}
            </select>
          </div>

          <div className="category-select-wrap">
            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
            >
              {ENTITIES.map((ent) => (
                <option key={ent} value={ent}>
                  {ent === 'ALL' ? 'Все сущности' : ent}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="panel table-wrap">
        <div className="section-head">
          <h2>События безопасности</h2>
          <span className="muted">Записей: {logs.length}</span>
        </div>

        {loading ? (
          <Loader text="Загружаем записи журнала аудита…" />
        ) : logs.length > 0 ? (
          <div className="table-responsive">
            <table className="data-table audit-table">
              <thead>
                <tr>
                  <th>Дата и время</th>
                  <th>Инициатор</th>
                  <th>Событие</th>
                  <th>Сущность</th>
                  <th style={{ textAlign: 'right' }}>Технические детали</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  let parsedMeta = null;
                  try {
                    parsedMeta = log.metadata ? JSON.parse(log.metadata) : null;
                  } catch {
                    parsedMeta = log.metadata;
                  }

                  const isWarn = log.action.includes('FAILED') || log.action.includes('DELETED') || log.action.includes('PENALTY');
                  const isExpanded = expandedLogId === log.id;

                  return (
                    <React.Fragment key={log.id}>
                      <tr>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <time className="audit-time">{formatDateTime(log.created_at)}</time>
                        </td>
                        <td>
                          <div className="audit-actor">
                            <b>{log.actor_name || 'Система'}</b>
                            {log.actor_login && <small className="muted">@{log.actor_login}</small>}
                          </div>
                        </td>
                        <td>
                          <div className="audit-desc-cell">
                            <strong className="audit-desc-text">
                              {log.human_description || log.action}
                            </strong>
                            <small className="muted">{log.action}</small>
                          </div>
                        </td>
                        <td>
                          <span className={`entity-tag ${isWarn ? 'warn' : ''}`}>
                            {log.entity_type} {log.entity_id ? `#${log.entity_id}` : ''}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn tiny ghost"
                            onClick={() => toggleExpand(log.id)}
                          >
                            {isExpanded ? 'Скрыть' : 'Детали'}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="audit-detail-row">
                          <td colSpan={5}>
                            <div className="audit-meta-expanded">
                              <span className="muted">Сырое действие: <code>{log.action}</code></span>
                              <span className="muted">Сущность: <code>{log.entity_type} #{log.entity_id}</code></span>
                              <div className="audit-meta-json">
                                <span className="muted">Параметры (JSON):</span>
                                <pre className="audit-code-block">
                                  {parsedMeta ? JSON.stringify(parsedMeta, null, 2) : '—'}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Записи аудита отсутствуют" text="По выбранным фильтрам событий не зафиксировано." />
        )}
      </div>
    </Page>
  );
}
