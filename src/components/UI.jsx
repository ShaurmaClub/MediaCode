import React from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  MapPin,
  Users,
  ArrowUpRight,
  Sparkles,
  Award,
  Clock
} from 'lucide-react';
import { formatDate, relativeTime } from '../api.js';

export const Page = ({ title, subtitle, eyebrow = 'МЕДИАКОД', actions, children }) => (
  <div className="page">
    <div className="page-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
    {children}
  </div>
);

export const Loader = ({ text = 'Загружаем данные…' }) => (
  <div className="loader">
    <div className="spinner" />
    <span>{text}</span>
  </div>
);

export const Empty = ({ title = 'Ничего не найдено', text = 'Здесь появится информация, когда будут новые события.' }) => (
  <div className="empty">
    <div className="empty-icon">✦</div>
    <b>{title}</b>
    <span>{text}</span>
  </div>
);

export const Avatar = ({ firstName, lastName, size = 'normal' }) => {
  const f = firstName?.[0] || '';
  const l = lastName?.[0] || '';
  const initials = (f + l).toUpperCase() || '?';
  return <div className={`avatar avatar-${size}`}>{initials}</div>;
};

export const StatusBadge = ({ status }) => {
  const map = {
    DRAFT: { label: 'Черновик', cls: 'status-draft' },
    OPEN: { label: 'Открыто', cls: 'status-open' },
    ASSIGNMENT_IN_PROGRESS: { label: 'В работе', cls: 'status-progress' },
    COMPLETED: { label: 'Завершено', cls: 'status-completed' },
    CANCELLED: { label: 'Отменено', cls: 'status-cancelled' },
    ARCHIVED: { label: 'В архиве', cls: 'status-archived' },
    APPLIED: { label: 'Заявка подана', cls: 'status-applied' },
    SELECTED: { label: 'Выбран', cls: 'status-selected' },
    REJECTED: { label: 'Отклонена', cls: 'status-rejected' },
    WITHDRAWN: { label: 'Отозвана', cls: 'status-withdrawn' },
    IN_PROGRESS: { label: 'В процессе', cls: 'status-progress' },
    COMPLETION_SUBMITTED: { label: 'Сдано на проверку', cls: 'status-submitted' },
    NO_SHOW: { label: 'Неявка', cls: 'status-noshow' }
  };
  const item = map[status] || { label: status, cls: 'status-default' };
  return (
    <span className={`badge ${item.cls}`}>
      <span className="badge-dot" />
      {item.label}
    </span>
  );
};

export const PriorityBadge = ({ priority }) => {
  if (!priority || priority === 'NORMAL') return null;
  const map = {
    LOW: { label: 'Низкий', cls: 'priority-low' },
    HIGH: { label: 'Высокий приоритет', cls: 'priority-high' },
    URGENT: { label: 'Срочно', cls: 'priority-urgent' }
  };
  const item = map[priority];
  if (!item) return null;
  return <span className={`priority-badge ${item.cls}`}>{item.label}</span>;
};

export function TaskCard({ task, isStaff = false }) {
  return (
    <Link to={`/tasks/${task.id}`} className="task-card">
      <div className="task-cover">
        <div className="task-cover-top">
          <span className="badge category-badge">{task.category || 'Событие'}</span>
          <PriorityBadge priority={task.priority} />
        </div>
        <div className="task-cover-points">
          +{task.points} <small>баллов</small>
        </div>
      </div>
      <div className="task-body">
        <h3>{task.title}</h3>
        <p className="muted clamp">{task.description || 'Без подробного описания'}</p>
        <div className="task-meta">
          <span>
            <CalendarDays size={14} /> {formatDate(task.event_date)}
            {task.start_time ? ` · ${task.start_time}` : ''}
          </span>
          {task.location && (
            <span>
              <MapPin size={14} /> {task.location}
            </span>
          )}
        </div>
        <div className="task-foot">
          <div className="task-foot-status">
            <StatusBadge status={task.application_status || task.status} />
          </div>
          <div className="task-foot-count">
            <Users size={13} />
            <span>
              {task.selected || 0}/{task.required_volunteers} мест
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export function PointRow({ point, detailed = false, onReverse = null }) {
  const isPositive = point.amount > 0;
  const isReversed = point.is_reversed === 1;

  return (
    <div className={`point-row ${isReversed ? 'point-row-reversed' : ''}`} style={isReversed ? { opacity: 0.65 } : {}}>
      <div className={`point-icon ${!isPositive ? 'negative' : ''}`}>
        <ArrowUpRight size={16} />
      </div>
      <div className="point-details">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <b style={isReversed ? { textDecoration: 'line-through' } : {}}>{point.reason}</b>
          {isReversed && (
            <span className="badge badge-danger" style={{ fontSize: '11px', padding: '2px 6px' }}>
              Отменено: {point.reversal_reason || 'корректировка'}
            </span>
          )}
          {point.reversal_of_id && (
            <span className="badge badge-secondary" style={{ fontSize: '11px', padding: '2px 6px' }}>
              Коррекция #{point.reversal_of_id}
            </span>
          )}
        </div>
        <small className="muted">
          Категория: {point.category || 'OTHER'}
          {point.task_title ? ` · «${point.task_title}»` : ''}
          {detailed && point.issuer_name ? ` · Выдал: ${point.issuer_name}` : ''}
        </small>
      </div>
      <div className="point-right" style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div>
          <strong className={`point-amount ${!isPositive ? 'negative' : 'positive'}`} style={isReversed ? { textDecoration: 'line-through' } : {}}>
            {isPositive ? '+' : ''}
            {point.amount}
          </strong>
          <time className="muted" style={{ display: 'block', fontSize: '11px' }}>{relativeTime(point.created_at)}</time>
        </div>
        {onReverse && isPositive && !isReversed && (
          <button
            type="button"
            className="btn tiny ghost danger-text"
            onClick={() => onReverse(point)}
            title="Отменить это начисление"
            style={{ padding: '4px 8px', fontSize: '11.5px', whiteSpace: 'nowrap' }}
          >
            Отменить
          </button>
        )}
      </div>
    </div>
  );
}
