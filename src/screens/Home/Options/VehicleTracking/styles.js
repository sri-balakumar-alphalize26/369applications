import { StyleSheet, Platform } from 'react-native';
import { COLORS, FONT_FAMILY } from '@constants/theme';

export const vehicleTrackingStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  calendarContainer: {
    marginBottom: 16,
  },
  calendar: {
    borderRadius: 10,
    ...Platform.select({
      android: { elevation: 2 },
      ios: {
        shadowColor: COLORS.black,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
      },
    }),
  },

  // Summary strip
  summaryRow: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 8,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    ...Platform.select({
      android: { elevation: 1 },
      ios: {
        shadowColor: COLORS.black,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 2,
      },
    }),
  },
  summaryNumber: {
    fontSize: 22,
    fontFamily: FONT_FAMILY.urbanistBold,
    lineHeight: 26,
  },
  summaryLabel: {
    marginTop: 2,
    fontSize: 11,
    color: COLORS.gray,
    fontFamily: FONT_FAMILY.urbanistMedium,
    letterSpacing: 0.3,
  },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 10,
  },
  sectionHeaderDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 8,
  },
  sectionHeaderTitle: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: COLORS.black,
    letterSpacing: 0.3,
  },
  sectionHeaderCount: {
    minWidth: 22,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeaderCountText: {
    color: '#FFF',
    fontSize: 11,
    fontFamily: FONT_FAMILY.urbanistBold,
  },

  // Trip card
  tripCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 4,
    ...Platform.select({
      android: { elevation: 2 },
      ios: {
        shadowColor: COLORS.black,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 3,
      },
    }),
  },
  tripCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  tripCardVehicle: {
    fontSize: 16,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: COLORS.black,
  },
  tripCardRef: {
    marginTop: 2,
    fontSize: 12,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: COLORS.primaryThemeColor,
    letterSpacing: 0.4,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 4,
  },
  statusPillText: {
    fontSize: 10,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.5,
  },
  tripCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 6,
  },
  tripCardSubtle: {
    flex: 1,
    fontSize: 13,
    color: COLORS.darkGray || '#444',
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
  tripCardRoute: {
    flex: 1,
    fontSize: 13,
    color: COLORS.black,
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
  offlineBadge: {
    backgroundColor: '#9E9E9E',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  offlineBadgeText: {
    color: '#FFF',
    fontSize: 9,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.5,
  },
  tripCardFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    gap: 14,
  },
  tripMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tripMetricText: {
    fontSize: 11,
    color: COLORS.gray,
    fontFamily: FONT_FAMILY.urbanistMedium,
  },

  contentContainer: {
    flex: 1,
    minHeight: 300,
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyStateTitle: {
    marginTop: 12,
    fontSize: 16,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: COLORS.black,
  },
  emptyStateSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: COLORS.gray,
    fontFamily: FONT_FAMILY.urbanistMedium,
    textAlign: 'center',
  },
  emptyStateText: {
    fontSize: 16,
    fontFamily: FONT_FAMILY.urbanistMedium,
    color: COLORS.red,
    textAlign: 'center',
  },

  // Form image upload (kept for compatibility with existing form references)
  imageUploadContainer: {
    marginVertical: 15,
    alignItems: 'flex-start',
  },
  imagePickerButton: {
    width: 80,
    height: 80,
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  imagePickerIcon: {
    fontSize: 24,
    color: 'white',
    position: 'absolute',
    top: 8,
    right: 8,
  },
  imagePickerText: {
    fontSize: 32,
    color: 'white',
    fontWeight: 'bold',
  },
});
