import numpy as np
from sklearn.linear_model import LinearRegression
from datetime import datetime
from typing import List, Dict, Any, cast

def get_daily_peaks(snapshots: List[Dict[str, Any]]) -> Dict[int, float]:
    """
    Groups snapshots by weekday and computes the average of the top 3 peaks for each day.
    Weekday Index: Monday=0 ... Sunday=6
    """
    days_data: Dict[int, List[int]] = {i: [] for i in range(7)}
    
    for snap in snapshots:
        ts = snap.get("snapshot_time")
        if not ts: continue
        
        # Ensure it's a datetime object
        if isinstance(ts, str):
            # Basic ISO format handling
            clean_ts = ts.replace("Z", "").split(".")[0]
            try:
                dt_obj = datetime.strptime(clean_ts, "%Y-%m-%dT%H:%M:%S")
            except:
                continue
        elif isinstance(ts, datetime):
            dt_obj = ts
        else:
            continue
            
        weekday = dt_obj.weekday()
        days_data[weekday].append(int(snap.get("records_count", 0)))
        
    daily_peaks: Dict[int, float] = {}
    for day, counts in days_data.items():
        if not counts:
            continue
        # Take top 3 and average them
        sorted_counts = sorted(counts, reverse=True)
        top_3 = sorted_counts[0:3] 
        daily_peaks[day] = float(sum(top_3)) / len(top_3)
        
    return daily_peaks

def rule_based_forecast(daily_peaks: Dict[int, float], current_load: float) -> float:
    """
    Statistical model using average, trend, specific weekday seasonality, and live load.
    Weights: 40% weekly, 25% trend, 25% seasonal, 10% live.
    """
    if not daily_peaks:
        return current_load
        
    all_peaks = list(daily_peaks.values())
    weekly_avg = sum(all_peaks) / len(all_peaks)
    
    # Trend Calculation (avg of last 3 detected days vs first 3)
    sorted_days = sorted(daily_peaks.keys())
    
    first_3_keys = sorted_days[0:3]
    last_3_keys = sorted_days[-3:]
    
    first_3_vals = [daily_peaks[d] for d in first_3_keys]
    last_3_vals = [daily_peaks[d] for d in last_3_keys]
    
    trend = (sum(last_3_vals)/len(last_3_vals)) - (sum(first_3_vals)/len(first_3_vals))
    
    # Seasonal Factor for tomorrow
    tomorrow_idx = (datetime.now().weekday() + 1) % 7
    seasonal_factor = daily_peaks.get(tomorrow_idx, weekly_avg)
    
    prediction = (
        0.40 * weekly_avg +
        0.25 * trend +
        0.25 * seasonal_factor +
        0.10 * current_load
    )
    
    return float(max(0.0, prediction))

def ml_forecast(daily_peaks: Dict[int, float], current_load: float) -> float:
    """
    Predicts using a simple Linear Regression model.
    Features: [day_index, current_load]
    """
    if len(daily_peaks) < 2:
        return current_load # Not enough data for regression
        
    # Prepare training data
    X = []
    y = []
    for day_idx, peak in daily_peaks.items():
        X.append([float(day_idx), float(current_load)])
        y.append(float(peak))
        
    model = LinearRegression()
    model.fit(np.array(X), np.array(y))
    
    # Predict for tomorrow
    tomorrow_idx = float((datetime.now().weekday() + 1) % 7)
    prediction = model.predict(np.array([[tomorrow_idx, float(current_load)]]))[0]
    
    return float(max(0.0, float(prediction)))

def hybrid_forecast(snapshots: List[Dict[str, Any]], current_load_percent: float) -> Dict[str, Any]:
    """
    Main entry point: Combines Rule-based (70%) and ML (30%) models.
    """
    if not snapshots:
        return {
            "rule_prediction": current_load_percent,
            "ml_prediction": current_load_percent,
            "final_prediction": current_load_percent,
            "traffic_level": "UNKNOWN",
            "message": "Insufficient data (no snapshots)"
        }
        
    daily_peaks = get_daily_peaks(snapshots)
    
    rule_pred = rule_based_forecast(daily_peaks, current_load_percent)
    ml_pred = ml_forecast(daily_peaks, current_load_percent)
    
    final_pred = (0.7 * rule_pred) + (0.3 * ml_pred)
    
    # Determine traffic level
    level = "LOW"
    if final_pred > 70:
        level = "HIGH"
    elif final_pred > 40:
        level = "MEDIUM"
        
    return {
        "rule_prediction": float(round(rule_pred, 1)),
        "ml_prediction": float(round(ml_pred, 1)),
        "final_prediction": float(round(final_pred, 1)),
        "traffic_level": level,
        "message": f"{level} congestion expected tomorrow"
    }
