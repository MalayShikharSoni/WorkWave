import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useAuth } from '../context/AuthProvider';
import { authAPI } from '../services/api';
import HeaderUser from './HeaderUser';
import AvatarUpload from '../components/AvatarUpload/AvatarUpload';
import styles from './ProfilePage.module.css';

const ProfilePage: React.FC = () => {
  const { userData, isLoading: authLoading, checkAuth } = useAuth();
  const user = userData?.data;
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const firstWaveRef = useRef<HTMLDivElement>(null);
  const thirdWaveRef = useRef<HTMLDivElement>(null);

  const [formData, setFormData] = useState({
    first_name: '',
    bio: '',
    phone: '',
    designation: '',
    department: '',
    linkedin_url: ''
  });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setFormData({
        first_name: user.first_name || user.firstName || '',
        bio: user.bio || '',
        phone: user.phone || '',
        designation: user.designation || '',
        department: user.department || '',
        linkedin_url: user.linkedin_url || ''
      });
    }
  }, [user]);

  // GSAP Entry Animation
  useGSAP(() => {
    if (containerRef.current) {
      gsap.to(containerRef.current, {
        opacity: 1,
        y: 0,
        duration: 0.6,
        ease: 'power3.out',
        delay: 0.1
      });
    }

    // Header wave parallax scroll (same as dashboards)
    if (firstWaveRef.current && thirdWaveRef.current) {
      gsap.fromTo(firstWaveRef.current, { x: 0 }, {
        x: '-40vw', ease: 'none',
        scrollTrigger: { trigger: containerRef.current, start: 'top top', end: 'bottom top', scrub: 1 }
      });
      gsap.fromTo(thirdWaveRef.current, { x: 0 }, {
        x: '42.5vw', ease: 'none',
        scrollTrigger: { trigger: containerRef.current, start: 'top top', end: 'bottom top', scrub: 1 }
      });
    }
  }, []);

  const changeUser = useCallback(() => {}, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const response = await authAPI.updateProfile(formData);
      if (response.data.success) {
        // Refresh local user context
        await checkAuth();
        alert('Profile updated successfully!');
      }
    } catch (error) {
      console.error('Failed to update profile:', error);
      const err = error as { response?: { data?: { error?: string } } };
      alert(err.response?.data?.error || 'Failed to update profile.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAvatarUpload = async () => {
    // Refresh user context to get new avatar URL
    await checkAuth();
  };

  if (authLoading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.loadingContent}>
          <div className={styles.spinner}></div>
          <p className={styles.loadingText}>Loading profile...</p>
        </div>
      </div>
    );
  }

  if (!userData) {
    return <Navigate to="/login" replace />;
  }

  if (!user) return null;

  return (
    <div className={styles.wrapper}>
      <HeaderUser
        ref={{ firstWaveRef, thirdWaveRef } as unknown as React.Ref<unknown>}
        changeUser={changeUser}
        data={userData.data}
        user={userData.data?.email}
      />
      <div className={styles.pageContainer} ref={containerRef} style={{ transform: 'translateY(20px)' }}>
        <div className={styles.header}>
          <h1 className={styles.title}>Your Profile</h1>
          <p className={styles.subtitle}>Manage your personal information and preferences.</p>
        </div>

        <div className={styles.profileCard}>
          <div className={styles.avatarSection}>
            <AvatarUpload
              currentAvatarUrl={user.avatar_url}
              name={user.first_name || user.firstName}
              size={120}
              onUploadSuccess={handleAvatarUpload}
            />
            <span className={styles.avatarHelp}>Click to update your avatar</span>
          </div>

          <form onSubmit={handleSubmit}>
            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label htmlFor="first_name" className={styles.label}>First Name</label>
                <input
                  type="text"
                  id="first_name"
                  name="first_name"
                  className={styles.input}
                  value={formData.first_name}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="phone" className={styles.label}>Phone Number</label>
                <input
                  type="tel"
                  id="phone"
                  name="phone"
                  className={styles.input}
                  value={formData.phone}
                  onChange={handleChange}
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="designation" className={styles.label}>Designation</label>
                <input
                  type="text"
                  id="designation"
                  name="designation"
                  className={styles.input}
                  value={formData.designation}
                  onChange={handleChange}
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="department" className={styles.label}>Department</label>
                <input
                  type="text"
                  id="department"
                  name="department"
                  className={styles.input}
                  value={formData.department}
                  onChange={handleChange}
                />
              </div>

              <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                <label htmlFor="linkedin_url" className={styles.label}>LinkedIn URL</label>
                <input
                  type="url"
                  id="linkedin_url"
                  name="linkedin_url"
                  className={styles.input}
                  value={formData.linkedin_url}
                  onChange={handleChange}
                  maxLength={255}
                  pattern="https://(www\.)?([a-z]{2,3}\.)?linkedin\.com/.*"
                  title="An https://linkedin.com/... link"
                  placeholder="https://linkedin.com/in/username"
                />
              </div>

              <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                <label htmlFor="bio" className={styles.label}>Bio</label>
                <textarea
                  id="bio"
                  name="bio"
                  className={styles.textarea}
                  value={formData.bio}
                  onChange={handleChange}
                  placeholder="Tell us a little about yourself..."
                />
              </div>
            </div>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btnCancel}
                onClick={() => navigate(-1)}
              >
                Back
              </button>
              <button
                type="submit"
                className={styles.btnSubmit}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
