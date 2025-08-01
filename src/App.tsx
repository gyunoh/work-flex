import { useState, useEffect, useRef } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import './App.css';

interface DayData {
  startTime: string; // 출근시간 (HH:MM:SS 형식)
  endTime: string;   // 퇴근시간 (HH:MM:SS 형식)
  workMinutes: number;
  otMinutes: number;
  nonWorkMinutes: number;
  vacation: 'none' | 'full' | 'half' | 'quarter' | '8h'; // 근태항목 (연차, 반차, 반반차, 기타)
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
    // 휴일: 휴게시간 차감 없이 전체 시간 인정
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
const parseHRData = (hrData: string): { startTime: string, endTime: string, vacation: 'none' | 'full' | 'half' | 'quarter' | '8h', nonWorkMinutes: number }[] => {
  const lines = hrData.trim().split('\n').filter(line => line.trim());
  return lines.map(line => {
    const parts = line.trim().split(/\s+/);
    let startTime = '';
    let endTime = '';
    let vacation: 'none' | 'full' | 'half' | 'quarter' | '8h' = 'none';
    let nonWorkMinutes = 0;

    // 근태항목이 있는 경우: (휴가)연차, (휴가)반차, (휴가)반반차, 기타
    // 예시: 07:22:23 08:05:55 (휴가)반반차 0
    if (parts.length >= 3 && parts[2].startsWith('(휴가)')) {
      startTime = parts[0] || '';
      endTime = parts[1] || '';
      const vacationStr = parts[2];
      if (vacationStr === '(휴가)연차') vacation = 'full';
      else if (vacationStr === '(휴가)반차') vacation = 'half';
      else if (vacationStr === '(휴가)반반차') vacation = 'quarter';
      else vacation = '8h'; // 기타 근태항목은 8시간 근태 처리
      nonWorkMinutes = parseInt(parts[3]) || 0;
    } else {
      // 근태항목이 없는 일반 케이스
      startTime = parts[0] || '';
      endTime = parts[1] || '';
      // parts[2]와 parts[3]는 휴게시간(시스템/수기)
      const break1 = parseInt(parts[2]) || 0;
      const break2 = parseInt(parts[3]) || 0;
      nonWorkMinutes = break1 + break2;
    }
    return { startTime, endTime, vacation, nonWorkMinutes };
  });
};

const VACATION_HOURS = {
  none: 0,
  full: 8 * 60, // 8시간을 분으로
  half: 4 * 60, // 4시간을 분으로
  quarter: 2 * 60, // 2시간을 분으로
  '8h': 8 * 60, // 기타 근태 항목은 8시간으로 처리
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
  const inputRef = useRef<HTMLInputElement>(null);

  // 컴포넌트 마운트 시 한 번만 실행되는 초기화
  useEffect(() => {
    // URL 해시에서 데이터 복원 시도
    let hashData: TwoWeekData | null = null;
    let hashValid = false;
    if (window.location.hash.startsWith('#!data=')) {
      try {
        const hashStr = decodeURIComponent(window.location.hash.replace('#!data=', ''));
        hashData = JSON.parse(hashStr);
        // hashData 형태 검증
        if (
          hashData &&
          typeof hashData === 'object' &&
          'week1' in hashData &&
          'week2' in hashData &&
          typeof hashData.week1 === 'object' &&
          typeof hashData.week2 === 'object'
        ) {
          hashValid = true;
          setData(hashData);
          localStorage.setItem('work-flex-data', JSON.stringify(hashData));
          toast.success('URL 해시에서 데이터가 로드되었습니다!');
        }
      } catch (error) {
        console.error('URL 해시 데이터를 읽는데 실패했습니다:', error);
      }
    }
    if (!hashValid) {
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
              if (mergedData[weekKey][day].breakfastBreakMinutes === undefined) {
                mergedData[weekKey][day].breakfastBreakMinutes = 0;
              }
              if (mergedData[weekKey][day].dinnerBreakMinutes === undefined) {
                mergedData[weekKey][day].dinnerBreakMinutes = 0;
              }
            }
          }
          setData(mergedData);
          // URL 해시도 동기화
          window.location.hash = `!data=${encodeURIComponent(JSON.stringify(mergedData))}`;
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
      const encoded = encodeURIComponent(JSON.stringify(data));
      window.location.hash = `!data=${encoded}`;
      localStorage.setItem('work-flex-data', JSON.stringify(data));
    }
  }, [data, isInitialized]);

  // 해시 변경 시 데이터 동기화
  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash.startsWith('#!data=')) {
        try {
          const hashStr = decodeURIComponent(window.location.hash.replace('#!data=', ''));
          const hashData = JSON.parse(hashStr);
          setData(hashData);
          localStorage.setItem('work-flex-data', JSON.stringify(hashData));
        } catch (e) {
          console.error('해시 데이터 파싱 실패:', e);
        }
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const updateDayData = (week: 'week1' | 'week2', day: string, field: keyof DayData, value: unknown) => {
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

        // 휴일 체크박스가 변경되면 근무시간 재계산 및 관련 값 초기화
        if (field === 'isHoliday') {
          const dayData = newData[week][day];
          if (dayData.startTime && dayData.endTime) {
            const calculatedWorkTime = calculateWorkTime(
              dayData.startTime,
              dayData.endTime,
              dayIndex,
              !!value
            );
            newData[week][day].workMinutes = calculatedWorkTime;
          }
          // 휴일로 변경 시 근태항목, 조식, 석식, 비업무시간 초기화
          if (value === true) {
            newData[week][day].vacation = 'none';
            newData[week][day].breakfastBreak = false;
            newData[week][day].dinnerBreak = false;
            newData[week][day].nonWorkMinutes = 0;
          }
        }
      }

      return newData;
    });
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
      // 휴일: 모든 근무시간을 10분 단위로 OT로 계산
      ot = Math.floor(actualWorkMinutes / 10) * 10;
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

  const openModal = (url: string) => {
    setModalContent(url);
    setIsModalOpen(true);
    setTimeout(() => {
      inputRef.current?.select();
    }, 100);
  };

  const shareData = () => {
    try {
      const encodedData = encodeURIComponent(JSON.stringify(data));
      const url = `${window.location.origin}${window.location.pathname}#!data=${encodedData}`;
      openModal(url);
    } catch (error) {
      console.error('URL 데이터 생성 실패:', error);
      toast.error('URL을 생성하는데 실패했습니다.');
    }
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(modalContent);
      toast.success('URL이 복사되었습니다!');
    } catch {
      toast.error('클립보드 복사에 실패했습니다.');
    }
  };

  const resetData = () => {
    if (confirm('모든 데이터를 초기화하시겠습니까?')) {
      // 로컬 스토리지 완전 삭제
      localStorage.removeItem('work-flex-data');
      // URL 해시도 삭제
      history.replaceState(null, '', window.location.pathname);
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
            newData[weekKey][day] = {
              ...newData[weekKey][day],
              startTime: dayInfo.startTime,
              endTime: dayInfo.endTime,
              vacation: dayInfo.vacation,
              nonWorkMinutes: dayInfo.nonWorkMinutes
            };
          }
        });
        return newData;
      });

      setBulkInputText('');
      setBulkInputMode(null);
      toast.success(`데이터가 성공적으로 입력되었습니다!`);
    } catch (error) {
      console.error(error)
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

      <div className="controls">
        <button onClick={shareData} className="share-btn">📤 URL 복사하기</button>
        <button onClick={resetData} className="reset-btn">🔄 초기화</button>
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
                📋 HR 데이터 붙여넣기
              </button>
            </div>
          </div>

          {/* 일괄 입력 모달 */}
          {bulkInputMode === weekKey && (
            <div className="bulk-input-modal">
              <div className="bulk-input-content">
                <h3>HR 데이터 입력</h3>
                <p>HR 개인출퇴근현황(본사/판교) 화면에서 인정출근시간~비업무시간-개인 셀을 붙여넣으세요.</p>
                <div className="bulk-input-example">
                  <strong>예시:</strong><br/>
                  <table style={{width: '100%', borderCollapse: 'collapse', fontSize: '13px', margin: '10px 0'}}>
                    <thead>
                      <tr style={{background: '#f0f0f0'}}>
                        <th style={{border: '1px solid #ddd', padding: '4px'}}>인정출근시간</th>
                        <th style={{border: '1px solid #ddd', padding: '4px'}}>인정퇴근시간</th>
                        <th style={{border: '1px solid #ddd', padding: '4px'}}>일일근태</th>
                        <th style={{border: '1px solid #ddd', padding: '4px'}}>비업무시간<br/>시스템</th>
                        <th style={{border: '1px solid #ddd', padding: '4px'}}>비업무시간<br/>개인</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}>08:20:22</td>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}>17:32:12</td>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}></td>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}>30</td>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}></td>
                      </tr>
                      <tr>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}>07:28:30</td>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}>18:26:53</td>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}></td>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}>30</td>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}></td>
                      </tr>
                      <tr>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}>07:28:46</td>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}>17:29:16</td>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}></td>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}>0</td>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}>30</td>
                      </tr>
                      <tr>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}>08:14:40</td>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}>18:28:54</td>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}></td>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}>30</td>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}></td>
                      </tr>
                      <tr>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}>07:22:23</td>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}>13:03:55</td>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}>(휴가)반차</td>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}></td>
                        <td style={{border: '1px solid #ddd', padding: '4px'}}></td>
                      </tr>
                    </tbody>
                  </table>
                  <div style={{fontSize: '12px', color: '#666', marginTop: '8px'}}>
                    <span>
                      ※ 최대 1주 단위까지만 적용 가능합니다.<br/>
                      ※ 근태항목은 (휴가)연차, (휴가)반차, (휴가)반반차 외에는 기타로 적용되며, 근무시간은 8시간으로 계산됩니다.
                    </span>
                  </div>
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
                  <th>비업무시간<br/>(시스템+개인)</th>
                  <th>휴일</th>
                  <th>근무시간</th>
                  <th>OT시간</th>
                  <th>OT신청시간</th>
                </tr>
              </thead>
              <tbody>
                {DAYS.map((day, dayIndex) => {
                  const dayData = data[weekKey][day];
                  const { actualWork, ot } = calculateDayWorkTime(dayData, dayIndex);

                  // 토요일, 일요일은 자동으로 휴일 표시
                  const isWeekendDay = isWeekend(dayIndex);
                  // 휴일 여부
                  const isHoliday = dayData.isHoliday || isWeekendDay;
                  // 휴일이거나 평일 휴일 근무인 경우 연차 선택 불가
                  const canControlWT = !isHoliday;
                  // 근태항목(연차, 반차, 반반차) 여부
                  const hasVacation = dayData.vacation !== 'none';

                  return (
                    <tr key={day} className={isWeekendDay ? 'weekend-row' : ''}>
                      <td className="day-cell">
                        {isHoliday && <span className="weekend-indicator">🏖️</span>}
                        {day}
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
                          disabled={!canControlWT}
                          title={!canControlWT ? '근태항목을 선택할 수 없습니다' : ''}
                        >
                          <option value="none">없음</option>
                          <option value="full">연차</option>
                          <option value="half">반차</option>
                          <option value="quarter">반반차</option>
                          <option value="8h">기타(8시간)</option>
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
                          disabled={isHoliday}
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
                          disabled={isHoliday}
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
                          disabled={isHoliday}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={dayData.isHoliday}
                          onChange={(e) => updateDayData(weekKey, day, 'isHoliday', e.target.checked)}
                          className="checkbox-input"
                          disabled={isWeekendDay}
                          title={isWeekendDay ? '토요일, 일요일은 자동으로 휴일입니다' : ''}
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
            <li>
              평일
              <ul>
                <li>일 최소 체류시간: 4시간 30분 (근무시간 4시간 + 휴게시간 30분)</li>
                <li>4시간 근무 시 30분 휴게시간 자동 제외</li>
                <li>일 근무시간이 9시간을 초과하는 경우 10분 단위로 OT 계산</li>
              </ul>
            </li>
            <li>
              휴일
              <ul>
                <li>휴게시간 차감 없음</li>
                <li>10분 단위로 OT 계산</li>
              </ul>
            </li>
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
            <h3>URL 복사하기</h3>
            <p>아래 URL을 복사해서 다른 곳에서도 데이터를 유지할 수 있습니다.</p>
            <input
              type="text"
              ref={inputRef}
              readOnly
              value={modalContent}
              className="modal-input"
              onFocus={e => e.target.select()}
              style={{ width: '100%', marginBottom: '20px' }}
            />
            <button onClick={handleCopyUrl} className="modal-copy-btn" style={{ marginRight: 8 }}>복사하기</button>
            <button onClick={closeModal} className="modal-close-btn">닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
