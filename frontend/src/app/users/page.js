'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import Sidebar from '@/components/Sidebar';
import TopAppBar from '@/components/TopAppBar';

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    username: '',
    password: '',
    role: 'user',
    kontak_telegram: ''
  });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { apiFetch } = useApi();
  const router = useRouter();

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiFetch('/api/users');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch users');
      setUsers(data.users || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    if (!authLoading) {
      if (!isAuthenticated || user?.role !== 'admin') {
        router.push('/');
        return;
      }
      fetchUsers();
    }
  }, [isAuthenticated, user, authLoading, router, fetchUsers]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const openAddModal = () => {
    setEditingId(null);
    setFormData({ name: '', username: '', password: '', role: 'user', kontak_telegram: '' });
    setFormError('');
    setIsModalOpen(true);
  };

  const openEditModal = (u) => {
    setEditingId(u.id);
    setFormData({
      name: u.name,
      username: u.username,
      password: '',
      role: u.role,
      kontak_telegram: u.kontak_telegram || ''
    });
    setFormError('');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);

    try {
      if (editingId) {
        const payload = { ...formData };
        if (!payload.password) delete payload.password;
        
        const res = await apiFetch(`/api/users/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to update user');
        }
      } else {
        const res = await apiFetch('/api/users', {
          method: 'POST',
          body: JSON.stringify(formData)
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to create user');
        }
      }
      
      setIsModalOpen(false);
      fetchUsers();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (id === user.id) {
      alert("You cannot delete your own account.");
      return;
    }
    
    if (!confirm('Are you sure you want to delete this user?')) return;
    
    try {
      const res = await apiFetch(`/api/users/${id}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete user');
      }
      fetchUsers();
    } catch (err) {
      alert(err.message);
    }
  };

  if (authLoading || !isAuthenticated) return null;

  return (
    <div className="main-dashboard">
      <Sidebar />
      <main className="main-content">
        <div className="main-canvas">
          <TopAppBar />
          <div className="scrollable-content">
            <div className="page-header-controls">
              <div className="page-title-section">
                <div className="heading-1"><h1>User Management</h1></div>
                <div className="status-indicator"><p>Manage system access, roles, and telegram alert contacts.</p></div>
              </div>
              <div className="page-controls">
                <button className="control-btn solid" onClick={openAddModal}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  Add New User
                </button>
              </div>
            </div>

            {error && <div style={{ margin: '0 0 16px', padding: '12px 16px', background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: '8px', color: '#dc2626' }}>{error}</div>}

            <div className="data-table-container">
              {loading ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading users...</div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Name</th>
                      <th>Username</th>
                      <th>Role</th>
                      <th>Telegram ID</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 ? (
                      <tr>
                        <td colSpan="6" style={{ textAlign: 'center', padding: '2rem' }}>No users found</td>
                      </tr>
                    ) : (
                      users.map(u => (
                        <tr key={u.id}>
                          <td>#{u.id}</td>
                          <td className="fw-500">{u.name}</td>
                          <td>{u.username}</td>
                          <td>
                            <span className={`status-badge ${u.role === 'admin' ? 'warning' : 'normal'}`}>
                              {u.role.toUpperCase()}
                            </span>
                          </td>
                          <td>{u.kontak_telegram || '—'}</td>
                          <td className="text-right">
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                              <button className="icon-btn" onClick={() => openEditModal(u)} title="Edit User">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                              </button>
                              {u.id !== user?.id && (
                                <button className="icon-btn" onClick={() => handleDelete(u.id)} title="Delete User" style={{ color: '#dc2626' }}>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {isModalOpen && (
            <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
              <div style={{ background: 'var(--card-bg, #fff)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '480px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>{editingId ? 'Edit User' : 'Add New User'}</h2>
                  <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-secondary)' }}>×</button>
                </div>
                <form onSubmit={handleSubmit}>
                  {formError && <div style={{ margin: '0 0 16px', padding: '10px 14px', background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: '8px', color: '#dc2626', fontSize: '13px' }}>{formError}</div>}
                  
                  <div className="form-group" style={{ marginBottom: '14px' }}>
                    <label className="form-label">Full Name</label>
                    <input type="text" name="name" className="form-input" required value={formData.name} onChange={handleInputChange} />
                  </div>
                  
                  <div className="form-group" style={{ marginBottom: '14px' }}>
                    <label className="form-label">Username</label>
                    <input type="text" name="username" className="form-input" required value={formData.username} onChange={handleInputChange} />
                  </div>
                  
                  <div className="form-group" style={{ marginBottom: '14px' }}>
                    <label className="form-label">Password {editingId && <span style={{fontSize:'0.8em', color:'var(--text-secondary)'}}>(Leave blank to keep current)</span>}</label>
                    <input type="password" name="password" className="form-input" required={!editingId} minLength="8" value={formData.password} onChange={handleInputChange} />
                  </div>
                  
                  <div className="form-group" style={{ marginBottom: '14px' }}>
                    <label className="form-label">Role</label>
                    <select name="role" className="form-input" value={formData.role} onChange={handleInputChange}>
                      <option value="user">USER</option>
                      <option value="admin">ADMIN</option>
                    </select>
                  </div>

                  <div className="form-group" style={{ marginBottom: '20px' }}>
                    <label className="form-label">Telegram ID</label>
                    <input type="text" name="kontak_telegram" className="form-input" placeholder="@username" value={formData.kontak_telegram} onChange={handleInputChange} />
                  </div>

                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <button type="button" className="control-btn outline" onClick={() => setIsModalOpen(false)}>Cancel</button>
                    <button type="submit" className={`control-btn solid ${submitting ? 'loading' : ''}`} disabled={submitting}>
                      {editingId ? 'Save Changes' : 'Create User'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
