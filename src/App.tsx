import { useState, useEffect } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import './App.css';

interface DayData {
  startTime: string; // 출근시간 (HH:MM:SS 형식)
  endTime: string;   // 퇴근시간 (HH:MM:SS 형식)
  workMinutes: number;
  otMinutes: number;
  nonWorkMinutes: number;
  vacation: 'none' | 'full' | 'half' | 'quarter';
  breakfastBreak: boolean;
  dinnerBreak: boolean;
  breakfastBreakMinutes: number; // 조식 휴게시간 (분)
  dinnerBreakMinutes: number;    // 석식 휴게시간 (분)
  isHoliday: boolean;
  requestedOT?: number; // OT 신청 시간 (선택적 속성)
}

interface WeekData {
  [key: string]: DayData;
}

interface TwoWeekData {
  week1: WeekData;
  week2: WeekData;
}

const DAYS = ['월', '화', '수', '목', '금', '토', '일'];

// 토요일, 일요일 확인 함수
const isWeekend = (dayIndex: number): boolean => {
  return dayIndex === 5 || dayIndex === 6; // 토요일(5), 일요일(6)
};

// 시간 문자열을 초로 변환 (HH:MM:SS 형식)
const timeStringToSeconds = (timeStr: string): number => {
  if (!timeStr) return 0;
  const parts = timeStr.split(':').map(p => parseInt(p) || 0);
  return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
};

// 초를 시간 문자열로 변환 (HH:MM:SS 형식)
const secondsToTimeString = (seconds: number): string => {
  if (seconds === 0) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

// 근무시간 계산 함수 개선 (초 단위) - HR 시스템 방식으로 수정
const calculateWorkTime = (startTime: string, endTime: string, dayIndex: number, isHolidayOverride: boolean = false): number => {
  if (!startTime || !endTime) return 0;

  const startSeconds = timeStringToSeconds(startTime);
  const endSeconds = timeStringToSeconds(endTime);

  let totalSeconds = endSeconds - startSeconds;
  if (totalSeconds < 0) totalSeconds += 24 * 3600; // 다음날로 넘어간 경우

  // 토요일, 일요일이거나 휴일 체크가 되어있으면 휴일로 처리
  const isHoliday = isWeekend(dayIndex) || isHolidayOverride;

  if (isHoliday) {
    // 휴일: 4시간 이상 시 30분 휴게시간만 제외
    if (totalSeconds >= 4 * 3600) {
      totalSeconds -= 30 * 60;
    }
    return Math.max(0, totalSeconds);
  } else {
    // 평일: HR 시스템 방식으로 휴게시간 계산
    // 출근시간부터 4시간마다 30분 휴게시간을 누적
    let workTime = totalSeconds;
    let currentTime = 0; // 출근시간부터의 경과시간
    let breakTime = 0;   // 누적된 휴게시간

    while (currentTime + 4 * 3600 <= totalSeconds) {
      // 4시간 근무 완료 시점마다 30분 휴게시간 추가
      currentTime += 4 * 3600; // 4시간 추가
      breakTime += 30 * 60;    // 30분 휴게시간 추가
      currentTime += 30 * 60;  // 휴게시간만큼 시간 흘림
    }

    workTime -= breakTime; // 총 휴게시간 차감
    return Math.max(0, workTime);
  }
};

// HR 시스템 데이터 파싱 함수 개선
const parseHRData = (hrData: string): { startTime: string, endTime: string, systemBreak: number, manualBreak: number }[] => {
  const lines = hrData.trim().split('\n').filter(line => line.trim());

  return lines.map(line => {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 3) {
      const startTime = parts[0] || '';
      const endTime = parts[1] || '';
      // parts[2]는 빈칸 또는 휴게시간 값
      const breakTime = parseInt(parts[2]) || 0;
      // 추가 휴게시간이 있다면 parts[3]에서 가져오기
      const additionalBreak = parseInt(parts[3]) || 0;

      return {
        startTime,
        endTime,
        systemBreak: breakTime,
        manualBreak: additionalBreak
      };
    }
    return { startTime: '', endTime: '', systemBreak: 0, manualBreak: 0 };
  });
};

const VACATION_HOURS = {
  none: 0,
  full: 8 * 60, // 8시간을 분으로
  half: 4 * 60, // 4시간을 분으로
  quarter: 2 * 60 // 2시간을 분으로
};

function App() {
  const [data, setData] = useState<TwoWeekData>(() => {
    const initialDay: DayData = {
      startTime: '',
      endTime: '',
      workMinutes: 0,
      otMinutes: 0,
      nonWorkMinutes: 0,
      vacation: 'none',
      breakfastBreak: false,
      dinnerBreak: false,
      breakfastBreakMinutes: 0,
      dinnerBreakMinutes: 0,
      isHoliday: false
    };

    const initialWeek: WeekData = DAYS.reduce((acc, day) => {
      acc[day] = { ...initialDay };
      return acc;
    }, {} as WeekData);

    return {
      week1: { ...initialWeek },
      week2: { ...initialWeek }
    };
  });

  const [bulkInputMode, setBulkInputMode] = useState<'week1' | 'week2' | null>(null);
  const [bulkInputText, setBulkInputText] = useState('');
  const [isInitialized, setIsInitialized] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState('');

  // 컴포넌트 마운트 시 한 번만 실행되는 초기화
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const dataParam = urlParams.get('data');

    if (dataParam) {
      // URL에서 데이터 로드
      try {
        const decodedData = JSON.parse(decodeURIComponent(dataParam));
        setData(decodedData);
        toast.success('URL에서 데이터가 로드되었습니다!');
      } catch (error) {
        console.error('URL 데이터를 읽는데 실패했습니다:', error);
        toast.error('URL 데이터를 읽는데 실패했습니다.');
      }
    } else {
      // 로컬 스토리지에서 데이터 복원
      const savedData = localStorage.getItem('work-flex-data');
      if (savedData) {
        try {
          const parsed = JSON.parse(savedData);
          const mergedData: TwoWeekData = {
            week1: {},
            week2: {}
          };

          for (const weekKey of ['week1', 'week2'] as const) {
            for (const day of DAYS) {
              const savedDayData = parsed[weekKey]?.[day];
              mergedData[weekKey][day] = {
                startTime: '',
                endTime: '',
                workMinutes: 0,
                otMinutes: 0,
                nonWorkMinutes: 0,
                vacation: 'none',
                breakfastBreak: false,
                dinnerBreak: false,
                breakfastBreakMinutes: 0,
                dinnerBreakMinutes: 0,
                isHoliday: false,
                ...savedDayData,
              };
              // 새로 추가된 필드들이 undefined인 경우 기본값 설정
              if (mergedData[weekKey][day].breakfastBreakMinutes === undefined) {
                mergedData[weekKey][day].breakfastBreakMinutes = 0;
              }
              if (mergedData[weekKey][day].dinnerBreakMinutes === undefined) {
                mergedData[weekKey][day].dinnerBreakMinutes = 0;
              }
            }
          }
          setData(mergedData);
          toast.success('저장된 데이터를 불러왔습니다!');
        } catch (error) {
          console.error('저장된 데이터 복원 실패:', error);
        }
      }
    }

    setIsInitialized(true);
  }, []); // 빈 의존성 배열로 한 번만 실행

  // 데이터 변경 시 자동 저장 (초기화 완료 후에만)
  useEffect(() => {
    if (isInitialized) {
      localStorage.setItem('work-flex-data', JSON.stringify(data));
    }
  }, [data, isInitialized]);

  const updateDayData = (week: 'week1' | 'week2', day: string, field: keyof DayData, value: any) => {
    setData(prev => {
      const newData = { ...prev };
      const dayIndex = DAYS.indexOf(day);

      // 출근시간이나 퇴근시간이 변경되면 자동으로 근무시간 계산
      if (field === 'startTime' || field === 'endTime') {
        const updatedDay = { ...newData[week][day], [field]: value };

        if (updatedDay.startTime && updatedDay.endTime) {
          const calculatedWorkTime = calculateWorkTime(
            updatedDay.startTime,
            updatedDay.endTime,
            dayIndex,
            updatedDay.isHoliday
          );
          updatedDay.workMinutes = calculatedWorkTime;
        }

        newData[week][day] = updatedDay;
      } else {
        // 다른 필드 업데이트
        newData[week][day] = {
          ...newData[week][day],
          [field]: value
        };

        // 휴일 체크박스가 변경되면 근무시간 재계산
        if (field === 'isHoliday') {
          const dayData = newData[week][day];
          if (dayData.startTime && dayData.endTime) {
            const calculatedWorkTime = calculateWorkTime(
              dayData.startTime,
              dayData.endTime,
              dayIndex,
              value
            );
            newData[week][day].workMinutes = calculatedWorkTime;
          }
        }
      }

      return newData;
    });
  };

  // 조식/석식 휴게시간 체크 시 자동으로 기본값 설정
  const handleBreakChange = (week: 'week1' | 'week2', day: string, breakType: 'breakfastBreak' | 'dinnerBreak', checked: boolean) => {
    if (checked) {
      // 체크되면 기본 30분 설정
      const minutesField = breakType === 'breakfastBreak' ? 'breakfastBreakMinutes' : 'dinnerBreakMinutes';
      updateDayData(week, day, breakType, true);
      updateDayData(week, day, minutesField, 30);
    } else {
      // 체크 해제되면 0분으로 설정
      const minutesField = breakType === 'breakfastBreak' ? 'breakfastBreakMinutes' : 'dinnerBreakMinutes';
      updateDayData(week, day, breakType, false);
      updateDayData(week, day, minutesField, 0);
    }
  };

  const calculateDayWorkTime = (dayData: DayData, dayIndex: number): { actualWork: number, ot: number } => {
    let actualWorkSeconds = 0;
    let ot = 0;

    // 출근시간과 퇴근시간이 있으면 자동 계산된 근무시간 사용 (초 단위)
    if (dayData.startTime && dayData.endTime) {
      actualWorkSeconds = calculateWorkTime(dayData.startTime, dayData.endTime, dayIndex, dayData.isHoliday);
    } else {
      // 직접 입력된 근무시간 사용 (분을 초로 변환)
      actualWorkSeconds = dayData.workMinutes * 60;
    }

    // 연차 처리 (분을 초로 변환)
    if (dayData.vacation !== 'none') {
      actualWorkSeconds += VACATION_HOURS[dayData.vacation] * 60;
    }

    // 비업무 시간 제외 (분을 초로 변환)
    actualWorkSeconds -= dayData.nonWorkMinutes * 60;

    // 조식/석식 휴게시간 제외 (분을 초로 변환)
    if (dayData.breakfastBreak) {
      actualWorkSeconds -= dayData.breakfastBreakMinutes * 60;
    }
    if (dayData.dinnerBreak) {
      actualWorkSeconds -= dayData.dinnerBreakMinutes * 60;
    }

    // 음수 방지
    actualWorkSeconds = Math.max(0, actualWorkSeconds);

    // 초를 분으로 변환하여 반환 (30초 단위 반올림)
    const actualWorkMinutes = Math.round(actualWorkSeconds / 60);

    // 토요일, 일요일이거나 휴일 체크가 되어있으면 휴일로 처리
    const isHoliday = isWeekend(dayIndex) || dayData.isHoliday;

    if (isHoliday) {
      // 휴일: 모든 시간이 OT (1시간 단위로 계산)
      ot = Math.floor(actualWorkMinutes / 60) * 60;
    } else {
      // 평일: 8시간 초과 시 OT 계산 (10분 단위)
      if (actualWorkMinutes > 8 * 60) {
        const excess = actualWorkMinutes - 8 * 60;
        ot = Math.floor(excess / 10) * 10;
      }
    }

    // 신청 불가 시간 제외
    if (ot < 60) {
      ot = 0;
    }

    return { actualWork: actualWorkMinutes, ot };
  };

  const calculateTotalStats = () => {
    let totalWork = 0;
    let totalOT = 0;
    let totalRequestedOT = 0;
    let totalApprovedOT = 0;
    const weekStats = [];

    for (const weekKey of ['week1', 'week2'] as const) {
      let weekWork = 0;
      let weekOT = 0;

      DAYS.forEach((day, dayIndex) => {
        const dayData = data[weekKey][day];
        const { actualWork, ot } = calculateDayWorkTime(dayData, dayIndex);
        weekWork += actualWork;
        weekOT += ot;

        // 각 일자별 OT인정시간 계산: OT신청시간과 OT시간 중 작은 값을 합산
        const approvedOTForDay = Math.min(ot, dayData.requestedOT || 0);
        totalApprovedOT += approvedOTForDay;
      });

      weekStats.push({ work: weekWork, ot: weekOT });
      totalWork += weekWork;
      totalOT += weekOT;
    }

    // 신청한 OT 시간 합산
    for (const weekKey of ['week1', 'week2'] as const) {
      for (const day of DAYS) {
        const dayData = data[weekKey][day];
        totalRequestedOT += dayData.requestedOT || 0;
      }
    }

    // 최소 근무시간 초과분만 OT인정시간으로 계산
    const minimumWorkMinutes = 80 * 60; // 2주 최소 근무시간 (80시간)
    const excessWorkMinutes = Math.max(0, totalWork - minimumWorkMinutes);
    totalApprovedOT = Math.min(totalApprovedOT, excessWorkMinutes);

    return {
      totalWork: Math.round(totalWork), // 30초 단위 반올림
      totalOT: Math.round(totalOT),     // 30초 단위 반올림
      totalRequestedOT: Math.round(totalRequestedOT), // 30초 단위 반올림
      totalApprovedOT: Math.round(totalApprovedOT), // 30초 단위 반올림
      weekStats,
      remainingWork: Math.max(0, 104 * 60 - Math.round(totalWork))
    };
  };

  const shareData = () => {
    try {
        const encodedData = encodeURIComponent(JSON.stringify(data));
        const url = `${window.location.origin}${window.location.pathname}?data=${encodedData}`;
        setModalContent(url);
        setIsModalOpen(true);
    } catch (error) {
        console.error('공유 데이터 생성 실패:', error);
        toast.error('공유 데이터를 생성하는데 실패했습니다.');
    }
  };

  const resetData = () => {
    if (confirm('모든 데이터를 초기화하시겠습니까?')) {
      // 로컬 스토리지 완전 삭제
      localStorage.removeItem('work-flex-data');
      // 페이지 새로고침으로 완전 초기화
      window.location.reload();
    }
  };

  const stats = calculateTotalStats();

  const formatTime = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}시간 ${mins}분`;
  };

  const convertTimeStringToMinutes = (timeStr: string): number => {
    if (!timeStr) return 0;

    // "8:30" 형식 처리
    if (timeStr.includes(':')) {
      const [hours, minutes] = timeStr.split(':').map(num => parseInt(num) || 0);
      return hours * 60 + minutes;
    }

    // 숫자만 입력된 경우 분으로 처리
    return parseInt(timeStr) || 0;
  };

  const convertMinutesToTimeString = (minutes: number): string => {
    if (minutes === 0) return '';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}:${mins.toString().padStart(2, '0')}` : `${hours}:00`;
  };

  // 일괄 입력 처리 함수 수정
  const handleBulkInput = (weekKey: 'week1' | 'week2') => {
    if (!bulkInputText.trim()) {
      toast.error('데이터를 입력해주세요.');
      return;
    }

    try {
      const parsedData = parseHRData(bulkInputText);

      setData(prev => {
        const newData = { ...prev };

        parsedData.forEach((dayInfo, index) => {
          if (index < DAYS.length && (dayInfo.startTime || dayInfo.endTime)) {
            const day = DAYS[index];

            // 시스템 휴게시간과 수기 휴게시간을 합산하여 비업무시간으로 처리
            const totalBreakTime = dayInfo.systemBreak + dayInfo.manualBreak;

            newData[weekKey][day] = {
              ...newData[weekKey][day],
              startTime: dayInfo.startTime,
              endTime: dayInfo.endTime,
              nonWorkMinutes: totalBreakTime
            };
          }
        });

        return newData;
      });

      setBulkInputText('');
      setBulkInputMode(null);
      toast.success(`데이터가 성공적으로 입력되었습니다!`);
    } catch (error) {
      toast.error('데이터 파싱에 실패했습니다. 형식을 확인해주세요.');
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
  };

  return (
    <div className="app">
      <Toaster position="top-right" />
      <h1>2주 단위 자율출퇴근제 근무시간 계산기</h1>

      <div className="controls">
        <button onClick={shareData} className="share-btn">📤 URL로 저장하기</button>
        <button onClick={resetData} className="reset-btn">🔄 초기화</button>
      </div>

      <div className="stats-summary">
        <div className="stats-row">
          <div className="stat-card">
            <h3>총 근무시간</h3>
            <p style={{ color: stats.totalWork > 104 * 60 ? '#f44336' : '#2196F3' }}>
              {formatTime(stats.totalWork)}
            </p>
          </div>
          <div className="stat-card">
            <h3>최소 근무시간 기준 남은 시간</h3>
            <p style={{ color: stats.totalWork < 80 * 60 ? '#f44336' : '#4CAF50' }}>
              {formatTime(Math.max(0, 80 * 60 - stats.totalWork))}
            </p>
          </div>
          <div className="stat-card">
            <h3>최대 근무시간 기준 남은 시간</h3>
            <p style={{ color: stats.totalWork > 104 * 60 ? '#f44336' : '#4CAF50' }}>
              {formatTime(Math.max(0, 104 * 60 - stats.totalWork))}
            </p>
          </div>
        </div>
        <div className="stats-row">
          <div className="stat-card">
            <h3>OT시간</h3>
            <p>{formatTime(stats.totalOT)}</p>
          </div>
          <div className="stat-card">
            <h3>OT신청시간</h3>
            <p>{formatTime(stats.totalRequestedOT)}</p>
          </div>
          <div className="stat-card">
            <h3>OT인정시간</h3>
            <p>{formatTime(stats.totalApprovedOT)}</p>
          </div>
        </div>
      </div>

      {/* 주간별 테이블 형식 입력 */}
      {(['week1', 'week2'] as const).map((weekKey, weekIndex) => (
        <div key={weekKey} className="week-section">
          <div className="week-header">
            <h2>{weekIndex + 1}주차 ({formatTime(stats.weekStats[weekIndex].work)})</h2>
            <div className="week-controls">
              <button
                onClick={() => setBulkInputMode(weekKey)}
                className="bulk-input-btn"
              >
                📋 HR시스템 데이터 붙여넣기
              </button>
            </div>
          </div>

          {/* 일괄 입력 모달 */}
          {bulkInputMode === weekKey && (
            <div className="bulk-input-modal">
              <div className="bulk-input-content">
                <h3>HR시스템 데이터 일괄 입력</h3>
                <p>HR시스템에서 복사한 데이터를 붙여넣으세요:</p>
                <div className="bulk-input-example">
                  <strong>예시 형식:</strong><br/>
                  07:38:28  18:26:37    0<br/>
                  07:38:19  19:58:23    30<br/>
                  07:27:58  17:35:21    0<br/>
                  (출근시간 퇴근시간 근태항목 시스템휴게시간 수기휴게시간)
                </div>
                <textarea
                  value={bulkInputText}
                  onChange={(e) => setBulkInputText(e.target.value)}
                  placeholder="HR시스템 데이터를 여기에 붙여넣으세요"
                  rows={10}
                  className="bulk-input-textarea"
                />
                <div className="bulk-input-buttons">
                  <button onClick={() => handleBulkInput(weekKey)} className="confirm-btn">
                    적용하기
                  </button>
                  <button onClick={() => {
                    setBulkInputMode(null);
                    setBulkInputText('');
                  }} className="cancel-btn">
                    취소
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 테이블 형식 입력 */}
          <div className="week-table">
            <table className="work-table">
              <thead>
                <tr>
                  <th>요일</th>
                  <th>출근시간</th>
                  <th>퇴근시간</th>
                  <th>근태항목</th>
                  <th>조식</th>
                  <th>석식</th>
                  <th>비업무시간(시스템+개인)</th>
                  <th>휴일</th>
                  <th>실제근무</th>
                  <th>OT시간</th>
                  <th>OT신청시간</th>
                </tr>
              </thead>
              <tbody>
                {DAYS.map((day, dayIndex) => {
                  const dayData = data[weekKey][day];
                  const { actualWork, ot } = calculateDayWorkTime(dayData, dayIndex);

                  // 토요일, 일요일은 자동으로 휴일 표시
                  const isAutoHoliday = isWeekend(dayIndex);
                  // 휴일이거나 평일 휴일근무인 경우 연차 선택 불가
                  const canSelectVacation = !isAutoHoliday && !dayData.isHoliday;
                  // 근태항목(연차, 반차, 반반차) 여부
                  const hasVacation = dayData.vacation !== 'none';

                  return (
                    <tr key={day} className={isAutoHoliday ? 'weekend-row' : ''}>
                      <td className="day-cell">
                        {day}
                        {isAutoHoliday && <span className="weekend-indicator">🏖️</span>}
                      </td>
                      <td>
                        <input
                          type="text"
                          placeholder="07:30:00"
                          value={dayData.startTime}
                          onChange={(e) => updateDayData(weekKey, day, 'startTime', e.target.value)}
                          className="time-input"
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          placeholder="18:30:00"
                          value={dayData.endTime}
                          onChange={(e) => updateDayData(weekKey, day, 'endTime', e.target.value)}
                          className="time-input"
                        />
                      </td>
                      <td>
                        <select
                          value={dayData.vacation}
                          onChange={(e) => updateDayData(weekKey, day, 'vacation', e.target.value)}
                          className="vacation-select"
                          disabled={!canSelectVacation}
                          title={!canSelectVacation ? '휴일에는 근태항목을 선택할 수 없습니다' : ''}
                        >
                          <option value="none">없음</option>
                          <option value="full">연차</option>
                          <option value="half">반차</option>
                          <option value="quarter">반반차</option>
                        </select>
                      </td>
                      <td className="break-time-cell">
                        <input
                          type="checkbox"
                          checked={dayData.breakfastBreak}
                          onChange={(e) => {
                            updateDayData(weekKey, day, 'breakfastBreak', e.target.checked);
                            updateDayData(weekKey, day, 'nonWorkMinutes', dayData.nonWorkMinutes + (e.target.checked ? 30 : -30));
                          }}
                          className="checkbox-input"
                        />
                      </td>
                      <td className="break-time-cell">
                        <input
                          type="checkbox"
                          checked={dayData.dinnerBreak}
                          onChange={(e) => {
                            updateDayData(weekKey, day, 'dinnerBreak', e.target.checked);
                            updateDayData(weekKey, day, 'nonWorkMinutes', dayData.nonWorkMinutes + (e.target.checked ? 30 : -30));
                          }}
                          className="checkbox-input"
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          placeholder="0:30"
                          value={dayData.nonWorkMinutes > 0 ? convertMinutesToTimeString(dayData.nonWorkMinutes) : ''}
                          onChange={(e) => {
                            const minutes = convertTimeStringToMinutes(e.target.value);
                            updateDayData(weekKey, day, 'nonWorkMinutes', minutes);
                          }}
                          className="time-input"
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={dayData.isHoliday}
                          onChange={(e) => updateDayData(weekKey, day, 'isHoliday', e.target.checked)}
                          className="checkbox-input"
                          disabled={isAutoHoliday}
                          title={isAutoHoliday ? '토요일, 일요일은 자동으로 휴일입니다' : ''}
                        />
                      </td>
                      <td className="result-cell">{formatTime(actualWork)}</td>
                      <td className="result-cell ot-cell">
                        {!hasVacation && ot <= 0 ? '' : (hasVacation || (ot < 60 && ot > 0) ? '신청불가' : `${formatTime(ot)} (${ot}분)`)}
                      </td>
                      <td>
                        <input
                          type="text"
                          placeholder="120"
                          value={dayData.requestedOT ? dayData.requestedOT.toString() : ''}
                          onChange={(e) => {
                            const value = parseInt(e.target.value);
                            if (!isNaN(value) && value >= 0) {
                              updateDayData(weekKey, day, 'requestedOT', value);
                            } else if (e.target.value === '') {
                              updateDayData(weekKey, day, 'requestedOT', undefined);
                            }
                          }}
                          className="time-input"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="rules">
        <details>
          <summary>계산 규칙 보기</summary>
          <ul>
            <li>일 최소 체류시간: 4시간 30분 (근무시간 4시간 + 휴게시간 30분)</li>
            <li>4시간 근무 시 30분 휴게시간 자동 제외</li>
            <li>평일: 8시간 초과 시 10분 단위로 OT 계산</li>
            <li>휴일: 1시간 단위로 OT 계산</li>
            <li>OT는 1시간 이상 근무한 경우에만 인정</li>
            <li>2주 합산 최소 80시간, 최대 104시간 근무</li>
            <li>연차 8시간, 반차 4시간, 반반차 2시간 근무시간 인정</li>
            <li>조식/석식 체크 시 각각 30분 비업무시간 추가</li>
            <li>비업무시간은 분단위로 근무시간에서 제외</li>
          </ul>
        </details>
      </div>

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>URL로 저장하기</h3>
            <p>아래 URL을 사용하여 다른 곳에서도 데이터를 유지할 수 있습니다.</p>
            <input
              type="text"
              readOnly
              value={modalContent}
              className="modal-input"
              onFocus={(e) => e.target.select()}
              style={{ width: '100%', marginBottom: '20px' }}
            />
            <button onClick={closeModal} className="modal-close-btn">닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
