import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, Plus, Filter, CalendarDays, CheckCircle2 } from 'lucide-react';
import { api } from '../api.js';
import { Page, Loader, Empty, TaskCard } from '../components/UI.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { EVENT_CATEGORIES } from '../config/eventCategories.js';

const CATEGORIES = ['Все категории', ...EVENT_CATEGORIES];

const STATUS_TABS = [
  { id: 'ALL', label: 'Все' },
  { id: 'OPEN', label: 'Открытые' },
  { id: 'ASSIGNMENT_IN_PROGRESS', label: 'В работе' },
  { id: 'COMPLETED', label: 'Завершённые' }
];

export default function Tasks({ user }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSearch = searchParams.get('search') || '';

  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(initialSearch);
  const [category, setCategory] = useState('Все категории');
  const [statusTab, setStatusTab] = useState('ALL');
  const toast = useToast();

  const loadTasks = async () => {
    try {
      setLoading(true);
      const query = new URLSearchParams();
      if (search.trim()) query.set('search', search.trim());
      if (category !== 'Все категории') query.set('category', category);
      if (statusTab !== 'ALL') query.set('status', statusTab);

      const res = await api(`/tasks?${query.toString()}`);
      setTasks(res);
    } catch (err) {
      toast.error('Не удалось загрузить список мероприятий: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
  }, [statusTab, category]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    loadTasks();
  };

  return (
    <Page
      title="Мероприятия медиацентра"
      subtitle="Найди интересное событие, прокачай свои навыки и заработай баллы активности."
      actions={
        user.role !== 'STUDENT' && (
          <Link to="/tasks/new" className="btn primary">
            <Plus size={16} /> Создать мероприятие
          </Link>
        )
      }
    >
      {/* Search & Filters Toolbar */}
      <div className="toolbar">
        <form className="search-box" onSubmit={handleSearchSubmit}>
          <Search size={16} className="search-icon" />
          <input
            type="text"
            placeholder="Поиск по названию, локации, навыкам…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit" className="btn tiny primary">Найти</button>
        </form>

        <div className="toolbar-filters">
          <div className="category-select-wrap">
            <Filter size={14} />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="category-select"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-tabs">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.id}
                className={`tab-btn ${statusTab === tab.id ? 'active' : ''}`}
                onClick={() => setStatusTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Task Grid */}
      {loading ? (
        <Loader text="Загружаем мероприятия…" />
      ) : tasks.length > 0 ? (
        <div className="task-grid wide">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} isStaff={user.role !== 'STUDENT'} />
          ))}
        </div>
      ) : (
        <Empty
          title="Мероприятия не найдены"
          text="Попробуйте изменить параметры поиска или фильтрации."
        />
      )}
    </Page>
  );
}
