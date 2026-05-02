import { FONT_FAMILY } from '@constants/theme';
import { BaseToast, ErrorToast } from 'react-native-toast-message';
export default CustomToast = {
    success: (props) => (
        <BaseToast
            {...props}
            style={{ borderLeftColor: 'green' }}
            contentContainerStyle={{ paddingHorizontal: 15 }}
            text2NumberOfLines={2}
            text1Style={{
                fontSize: 15,
                fontWeight: '400',
                fontFamily: FONT_FAMILY.urbanistBold
            }}
            text2Style={{
                fontSize: 13,
                fontFamily: FONT_FAMILY.urbanistBold,
                fontWeight: '400',
                flexShrink: 1,
            }}
        />
    ),

    error: (props) => (
        <ErrorToast
            {...props}
            text2NumberOfLines={2}
            text1Style={{
                fontSize: 15,
                fontFamily: FONT_FAMILY.urbanistBold,
                fontWeight: '400',
            }}
            text2Style={{
                fontSize: 13,
                fontFamily: FONT_FAMILY.urbanistBold,
                fontWeight: '400',
                flexShrink: 1,
            }}
        />
    ),
};