import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  Kos,
  Review,
  VisitBooking,
  RentalBooking,
  UserProfile,
  RoomStatus,
  Room,
} from '../types';
import { INITIAL_KOS_LIST } from '../data/mockKos';
import { INITIAL_REVIEWS } from '../data/mockReviews';
import { INITIAL_RENTAL_BOOKINGS, INITIAL_VISIT_BOOKINGS, INITIAL_CURRENT_USER } from '../data/mockTenants';

export interface ToastNotification {
  id: string;
  type: 'success' | 'info' | 'warning' | 'error';
  message: string;
}

interface AppContextType {
  currentUser: UserProfile;
  activePersona: 'student' | 'owner';
  setActivePersona: (role: 'student' | 'owner') => void;
  kosList: Kos[];
  reviews: Review[];
  visits: VisitBooking[];
  rentals: RentalBooking[];
  selectedOwnerKosId: string;
  setSelectedOwnerKosId: (id: string) => void;
  // Search & Filter State
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedCampusId: string;
  setSelectedCampusId: (campusId: string) => void;
  genderFilter: 'all' | 'campur' | 'putra' | 'putri';
  setGenderFilter: (gender: 'all' | 'campur' | 'putra' | 'putri') => void;
  sortBy: 'rating' | 'price_asc' | 'distance_asc';
  setSortBy: (sort: 'rating' | 'price_asc' | 'distance_asc') => void;
  maxPrice: number;
  setMaxPrice: (price: number) => void;
  filterDiscountOnly: boolean;
  setFilterDiscountOnly: (val: boolean) => void;
  filterSurveyOnly: boolean;
  setFilterSurveyOnly: (val: boolean) => void;
  hoveredKosId: string | null;
  setHoveredKosId: (id: string | null) => void;
  // Actions
  toggleWishlist: (kosId: string) => void;
  scheduleVisit: (booking: Omit<VisitBooking, 'id' | 'createdAt' | 'status'>) => void;
  cancelVisit: (visitId: string) => void;
  createRentalBooking: (booking: Omit<RentalBooking, 'id' | 'createdAt' | 'digitalReceiptNumber'>) => RentalBooking;
  updateRoomStatus: (kosId: string, roomId: string, newStatus: RoomStatus, tenantDetails?: { name?: string; phone?: string; campus?: string; dueDate?: string }) => void;
  addKos: (kos: Omit<Kos, 'id' | 'rating' | 'reviewCount'>) => Kos;
  updateKos: (kosId: string, updated: Partial<Kos>) => void;
  deleteKos: (kosId: string) => void;
  addRoomToKos: (kosId: string, room: Omit<Room, 'id' | 'kosId'>) => void;
  deleteRoomFromKos: (kosId: string, roomId: string) => void;
  addReview: (review: Omit<Review, 'id' | 'date'>) => void;
  replyToReview: (reviewId: string, replyText: string) => void;
  updateUserProfile: (profile: Partial<UserProfile>) => void;
  // Toasts
  toasts: ToastNotification[];
  addToast: (message: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
  removeToast: (id: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY_KOS = 'kobo_app_kos_list_v1';
const LOCAL_STORAGE_KEY_REVIEWS = 'kobo_app_reviews_v1';
const LOCAL_STORAGE_KEY_VISITS = 'kobo_app_visits_v1';
const LOCAL_STORAGE_KEY_RENTALS = 'kobo_app_rentals_v1';
const LOCAL_STORAGE_KEY_USER = 'kobo_app_user_v1';
const LOCAL_STORAGE_KEY_PERSONA = 'kobo_app_active_persona_v1';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // State initialization with localStorage fallback
  const [kosList, setKosList] = useState<Kos[]>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY_KOS);
    return saved ? JSON.parse(saved) : INITIAL_KOS_LIST;
  });

  const [reviews, setReviews] = useState<Review[]>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY_REVIEWS);
    return saved ? JSON.parse(saved) : INITIAL_REVIEWS;
  });

  const [visits, setVisits] = useState<VisitBooking[]>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY_VISITS);
    return saved ? JSON.parse(saved) : INITIAL_VISIT_BOOKINGS;
  });

  const [rentals, setRentals] = useState<RentalBooking[]>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY_RENTALS);
    return saved ? JSON.parse(saved) : INITIAL_RENTAL_BOOKINGS;
  });

  const [currentUser, setCurrentUser] = useState<UserProfile>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY_USER);
    return saved ? JSON.parse(saved) : INITIAL_CURRENT_USER;
  });

  const [activePersona, setActivePersonaState] = useState<'student' | 'owner'>(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const roleParam = urlParams.get('role');
      if (roleParam === 'owner' || roleParam === 'student') {
        localStorage.setItem(LOCAL_STORAGE_KEY_PERSONA, roleParam);
        return roleParam;
      }
      // If path starts with /owner, default to owner
      if (window.location.pathname.startsWith('/owner')) {
        return 'owner';
      }
    }
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY_PERSONA);
    return (saved as 'student' | 'owner') || 'student';
  });

  const [selectedOwnerKosId, setSelectedOwnerKosId] = useState<string>('kos-1');

  // Search & Filter State (Default sort: Rating highest per idea.md)
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCampusId, setSelectedCampusId] = useState<string>('');
  const [genderFilter, setGenderFilter] = useState<'all' | 'campur' | 'putra' | 'putri'>('all');
  const [sortBy, setSortBy] = useState<'rating' | 'price_asc' | 'distance_asc'>('rating');
  const [maxPrice, setMaxPrice] = useState<number>(3000000);
  const [filterDiscountOnly, setFilterDiscountOnly] = useState<boolean>(false);
  const [filterSurveyOnly, setFilterSurveyOnly] = useState<boolean>(false);
  const [hoveredKosId, setHoveredKosId] = useState<string | null>(null);

  // Toast notifications
  const [toasts, setToasts] = useState<ToastNotification[]>([]);

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY_KOS, JSON.stringify(kosList));
  }, [kosList]);

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY_REVIEWS, JSON.stringify(reviews));
  }, [reviews]);

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY_VISITS, JSON.stringify(visits));
  }, [visits]);

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY_RENTALS, JSON.stringify(rentals));
  }, [rentals]);

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY_USER, JSON.stringify(currentUser));
  }, [currentUser]);

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY_PERSONA, activePersona);
  }, [activePersona]);

  const addToast = (message: string, type: 'success' | 'info' | 'warning' | 'error' = 'success') => {
    const id = 'toast-' + Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      removeToast(id);
    }, 4000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const setActivePersona = (role: 'student' | 'owner') => {
    setActivePersonaState(role);
    addToast(`Beralih ke ${role === 'student' ? 'Mode Mahasiswa / Pencari Kos' : 'Mode Pemilik Kos'}`, 'info');
  };

  const toggleWishlist = (kosId: string) => {
    setCurrentUser((prev) => {
      const isSaved = prev.savedKosIds.includes(kosId);
      const updated = isSaved
        ? prev.savedKosIds.filter((id) => id !== kosId)
        : [...prev.savedKosIds, kosId];
      addToast(isSaved ? 'Dihapus dari kos favorit' : 'Ditambahkan ke kos favorit', 'success');
      return { ...prev, savedKosIds: updated };
    });
  };

  const scheduleVisit = (booking: Omit<VisitBooking, 'id' | 'createdAt' | 'status'>) => {
    const newVisit: VisitBooking = {
      ...booking,
      id: 'vis-' + Math.random().toString(36).substring(2, 9),
      status: 'scheduled',
      createdAt: new Date().toISOString(),
    };
    setVisits((prev) => [newVisit, ...prev]);
    addToast(`Jadwal survey ke ${booking.kosName} berhasil dikonfirmasi!`, 'success');
  };

  const cancelVisit = (visitId: string) => {
    setVisits((prev) => prev.filter((v) => v.id !== visitId));
    addToast('Jadwal survey telah dibatalkan.', 'info');
  };

  const createRentalBooking = (booking: Omit<RentalBooking, 'id' | 'createdAt' | 'digitalReceiptNumber'>): RentalBooking => {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const receiptNum = `KB-KOB-${dateStr}-${Math.floor(1000 + Math.random() * 9000)}`;
    const newRental: RentalBooking = {
      ...booking,
      id: 'rent-' + Math.random().toString(36).substring(2, 9),
      digitalReceiptNumber: receiptNum,
      createdAt: now.toISOString(),
    };
    setRentals((prev) => [newRental, ...prev]);

    // Update room status to 'paid'
    updateRoomStatus(booking.kosId, booking.roomId, 'paid', {
      name: booking.studentName,
      phone: booking.studentPhone,
      campus: booking.studentCampus,
      dueDate: booking.nextDueDate,
    });

    addToast(`Pembayaran sewa kamar berhasil! Kuitansi resmi ${receiptNum} telah diterbitkan.`, 'success');
    return newRental;
  };

  const updateRoomStatus = (
    kosId: string,
    roomId: string,
    newStatus: RoomStatus,
    tenantDetails?: { name?: string; phone?: string; campus?: string; dueDate?: string }
  ) => {
    setKosList((prev) =>
      prev.map((k) => {
        if (k.id !== kosId) return k;
        const updatedRooms = k.rooms.map((r) => {
          if (r.id !== roomId) return r;
          return {
            ...r,
            status: newStatus,
            tenantName: tenantDetails?.name !== undefined ? tenantDetails.name : r.tenantName,
            tenantPhone: tenantDetails?.phone !== undefined ? tenantDetails.phone : r.tenantPhone,
            tenantCampus: tenantDetails?.campus !== undefined ? tenantDetails.campus : r.tenantCampus,
            dueDate: tenantDetails?.dueDate !== undefined ? tenantDetails.dueDate : r.dueDate,
            daysOverdue: newStatus === 'overdue' ? (r.daysOverdue || 3) : undefined,
          };
        });
        const available = updatedRooms.filter((r) => r.status === 'vacant').length;
        return {
          ...k,
          rooms: updatedRooms,
          availableRooms: available,
        };
      })
    );
    addToast('Status kamar berhasil diperbarui.', 'success');
  };

  const addKos = (newKosData: Omit<Kos, 'id' | 'rating' | 'reviewCount'>): Kos => {
    const id = 'kos-' + (kosList.length + 1);
    const newKos: Kos = {
      ...newKosData,
      id,
      rating: 5.0,
      reviewCount: 0,
    };
    setKosList((prev) => [newKos, ...prev]);
    setSelectedOwnerKosId(id);
    addToast(`Properti kos "${newKos.name}" berhasil didaftarkan!`, 'success');
    return newKos;
  };

  const updateKos = (kosId: string, updated: Partial<Kos>) => {
    setKosList((prev) =>
      prev.map((k) => (k.id === kosId ? { ...k, ...updated } : k))
    );
    addToast('Informasi kos berhasil diperbarui.', 'success');
  };

  const deleteKos = (kosId: string) => {
    setKosList((prev) => prev.filter((k) => k.id !== kosId));
    if (selectedOwnerKosId === kosId) {
      const remaining = kosList.filter((k) => k.id !== kosId);
      if (remaining.length > 0) {
        setSelectedOwnerKosId(remaining[0].id);
      }
    }
    addToast('Properti kos telah dihapus.', 'info');
  };

  const addRoomToKos = (kosId: string, roomData: Omit<Room, 'id' | 'kosId'>) => {
    setKosList((prev) =>
      prev.map((k) => {
        if (k.id !== kosId) return k;
        const newRoom: Room = {
          ...roomData,
          id: `room-${kosId}-${Math.random().toString(36).substring(2, 6)}`,
          kosId,
        };
        const updatedRooms = [...k.rooms, newRoom];
        return {
          ...k,
          rooms: updatedRooms,
          totalRooms: updatedRooms.length,
          availableRooms: updatedRooms.filter((r) => r.status === 'vacant').length,
        };
      })
    );
    addToast(`Kamar ${roomData.roomNumber} berhasil ditambahkan!`, 'success');
  };

  const deleteRoomFromKos = (kosId: string, roomId: string) => {
    setKosList((prev) =>
      prev.map((k) => {
        if (k.id !== kosId) return k;
        const updatedRooms = k.rooms.filter((r) => r.id !== roomId);
        return {
          ...k,
          rooms: updatedRooms,
          totalRooms: updatedRooms.length,
          availableRooms: updatedRooms.filter((r) => r.status === 'vacant').length,
        };
      })
    );
    addToast('Kamar berhasil dihapus.', 'info');
  };

  const addReview = (reviewData: Omit<Review, 'id' | 'date'>) => {
    const newRev: Review = {
      ...reviewData,
      id: 'rev-' + Math.random().toString(36).substring(2, 9),
      date: 'Hari ini',
    };
    setReviews((prev) => [newRev, ...prev]);

    // Recalculate kos rating
    const kosRevs = [...reviews.filter((r) => r.kosId === reviewData.kosId), newRev];
    const avg = kosRevs.reduce((acc, r) => acc + r.ratingOverall, 0) / kosRevs.length;

    setKosList((prev) =>
      prev.map((k) =>
        k.id === reviewData.kosId
          ? {
              ...k,
              rating: Number(avg.toFixed(1)),
              reviewCount: kosRevs.length,
            }
          : k
      )
    );
    addToast('Ulasan Anda berhasil dikirim! Terima kasih.', 'success');
  };

  const replyToReview = (reviewId: string, replyText: string) => {
    setReviews((prev) =>
      prev.map((r) =>
        r.id === reviewId
          ? {
              ...r,
              ownerReply: {
                text: replyText,
                date: 'Baru saja',
              },
            }
          : r
      )
    );
    addToast('Tanggapan pemilik berhasil dipublikasikan.', 'success');
  };

  const updateUserProfile = (profile: Partial<UserProfile>) => {
    setCurrentUser((prev) => ({ ...prev, ...profile }));
    addToast('Profil berhasil diperbarui.', 'success');
  };

  return (
    <AppContext.Provider
      value={{
        currentUser,
        activePersona,
        setActivePersona,
        kosList,
        reviews,
        visits,
        rentals,
        selectedOwnerKosId,
        setSelectedOwnerKosId,
        searchQuery,
        setSearchQuery,
        selectedCampusId,
        setSelectedCampusId,
        genderFilter,
        setGenderFilter,
        sortBy,
        setSortBy,
        maxPrice,
        setMaxPrice,
        filterDiscountOnly,
        setFilterDiscountOnly,
        filterSurveyOnly,
        setFilterSurveyOnly,
        hoveredKosId,
        setHoveredKosId,
        toggleWishlist,
        scheduleVisit,
        cancelVisit,
        createRentalBooking,
        updateRoomStatus,
        addKos,
        updateKos,
        deleteKos,
        addRoomToKos,
        deleteRoomFromKos,
        addReview,
        replyToReview,
        updateUserProfile,
        toasts,
        addToast,
        removeToast,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useAppStore = (): AppContextType => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppStore must be used within an AppProvider');
  }
  return context;
};
